import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import { joinChannel, leaveChannel, setMuted, setCameraOff, switchCamera } from '../lib/agora'
import {
  MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon,
  VideoIcon, VideoOffIcon, FlipCameraIcon, PhoneIcon, PhoneOffIcon,
} from '../components/CallIcons'
import { stopNativeCallAlarm } from '../lib/nativeCallAlarm'
import { startNativeCallAudio, setNativeSpeakerOn, stopNativeCallAudio } from '../lib/nativeCallAudio'

const CALLER_NO_ANSWER_MS = 45000

function formatDuration(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function CallPage() {
  const t = useT()
  const { callId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  // Read live from the URL, NOT captured at mount. Accepting from the native
  // full-screen alert deep-links to /call/:id?action=accept, but this screen
  // is often already mounted by then (useCallSignaling discovers the ringing
  // call independently). A mount-time snapshot missed the param in that case,
  // so the auto-accept never fired and the user was shown the manual green
  // Accept button instead — having to press Accept a second time.
  const actionParam = searchParams.get('action')
  const hasPendingAutoAction = actionParam === 'accept' || actionParam === 'decline'
  const autoActionFiredRef = useRef(false)

  const [call, setCall]         = useState(null)
  const [otherName, setOtherName] = useState('')
  const [otherAvatar, setOtherAvatar] = useState('')
  const [loading, setLoading]   = useState(true)
  const [joined, setJoined]     = useState(false)
  const [muted, setMutedState]  = useState(false)
  const [cameraOff, setCameraOffState] = useState(false)
  const [facingMode, setFacingMode] = useState('user')
  const [flipping, setFlipping] = useState(false)
  const [speakerOn, setSpeakerOnState] = useState(false)
  const [elapsed, setElapsed]   = useState(0)
  const [ending, setEnding]     = useState(false)
  const [joinError, setJoinError] = useState('')

  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)
  const noAnswerTimer  = useRef(null)
  const durationTimer  = useRef(null)
  const joinedRef      = useRef(false)
  const endedNavigatedRef = useRef(false)

  const isCaller = call && user && call.caller_id === user.id
  const isVideo  = call?.call_type === 'video'

  // ── Load the call row + subscribe to updates ────────────────────────────
  useEffect(() => {
    if (!callId) return
    let cancelled = false

    const load = async () => {
      const { data, error } = await supabase.from('calls').select('*').eq('id', callId).single()
      if (cancelled) return
      if (error || !data) {
        navigate('/', { replace: true })
        return
      }
      setCall(data)
      setLoading(false)

      const otherId = data.caller_id === user?.id ? data.callee_id : data.caller_id
      const { data: member } = await supabase
        .from('family_members')
        .select('display_name, avatar_url')
        .eq('user_id', otherId)
        .eq('family_id', data.family_id)
        .maybeSingle()
      if (!cancelled) {
        setOtherName(member?.display_name || 'Family member')
        setOtherAvatar(member?.avatar_url || '')
      }
    }
    load()

    const channel = supabase
      .channel(`call:${callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}`,
      }, (payload) => { if (!cancelled) setCall(payload.new) })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [callId, user?.id, navigate])

  // ── Auto-fire Accept/Decline tapped from the native full-screen ringing UI ─
  // (CallRingingActivity → MainActivity.handleCallIntent → ?action=accept|decline)
  useEffect(() => {
    if (autoActionFiredRef.current) return
    if (!call || call.status !== 'ringing' || isCaller) return
    if (actionParam !== 'accept' && actionParam !== 'decline') return
    autoActionFiredRef.current = true
    console.log('[CallPage] auto-' + actionParam + ' from native full-screen alert')
    const acceptedId = call.id
    supabase.rpc('respond_to_call', { p_call_id: acceptedId, p_action: actionParam })
      .then(({ error }) => {
        if (error) {
          console.error('[CallPage] auto-' + actionParam + ' failed:', error.message)
          return
        }
        // Re-read the row instead of waiting for the realtime UPDATE. On a
        // cold start (answering from the lock screen) the row is fetched while
        // still 'ringing' and the subscription is not established until after
        // this accept lands, so the status change was missed entirely — the
        // caller connected while this side sat on "Connecting…" forever and
        // never joined the audio channel.
        console.log('[CallPage] auto-' + actionParam + ' ok, refreshing call row')
        supabase.from('calls').select('*').eq('id', acceptedId).single()
          .then(({ data }) => { if (data) setCall(data) })
      })
  }, [call?.id, call?.status, isCaller, actionParam])

  // ── Safety net: poll while ringing ───────────────────────────────────────
  // The realtime UPDATE that flips 'ringing' -> 'accepted' can be missed
  // whenever this screen mounts during a cold start, because the subscription
  // is established after the status has already changed. Without this, the
  // call sits on "Connecting…" indefinitely while the other side is connected.
  useEffect(() => {
    if (!call || call.status !== 'ringing') return
    let cancelled = false
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('calls').select('*').eq('id', call.id).single()
      // Without this a request issued for the previous call can resolve after
      // the effect re-ran for a new one, writing the old row over the new call.
      if (cancelled) return
      if (data && data.status !== 'ringing') {
        console.log('[CallPage] poll picked up status change ->', data.status)
        setCall(data)
      }
    }, 2000)
    return () => { cancelled = true; clearInterval(poll) }
  }, [call?.id, call?.status])

  // ── Caller: give up if nobody answers ───────────────────────────────────
  useEffect(() => {
    if (!call || !isCaller || call.status !== 'ringing') return
    noAnswerTimer.current = setTimeout(() => {
      supabase.rpc('mark_call_missed', { p_call_id: call.id })
    }, CALLER_NO_ANSWER_MS)
    return () => clearTimeout(noAnswerTimer.current)
  }, [call?.id, call?.status, isCaller])

  // ── Join the Agora channel once the call is accepted ────────────────────
  useEffect(() => {
    if (!call || call.status !== 'accepted' || joinedRef.current) return
    joinedRef.current = true
    stopNativeCallAlarm()

    const doJoin = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('generate-agora-token', {
          body: { call_id: call.id },
        })
        if (error || !data?.token) {
          console.error('[CallPage] Failed to get Agora token:', error?.message)
          setJoinError('Could not connect the call. Please check your internet and try again')
          return
        }
        console.log('[CallPage] Got Agora token, joining channel', data.channelName)

        // Set call audio routing BEFORE requesting the mic/camera — Chromium's
        // WebRTC audio device selection happens at getUserMedia() time, so
        // switching AudioManager mode/route afterward (as this used to do)
        // was often too late to actually move the previously-opened audio
        // session onto the earpiece.
        const defaultSpeaker = call.call_type === 'video'
        setSpeakerOnState(defaultSpeaker)
        await startNativeCallAudio(defaultSpeaker)

        const uid = Math.floor(Math.random() * 1_000_000_000)
        const { localVideoTrack } = await joinChannel({
          appId:       data.appId,
          token:       data.token,
          channelName: data.channelName,
          uid,
          callType:    call.call_type,
          onRemoteUser: (remoteUser, mediaType) => {
            console.log('[CallPage] Remote user published', mediaType)
            if (mediaType === 'video' && remoteVideoRef.current) {
              remoteUser.videoTrack?.play(remoteVideoRef.current)
            } else if (mediaType === 'audio') {
              remoteUser.audioTrack?.play()
            }
          },
        })
        if (localVideoTrack && localVideoRef.current) {
          localVideoTrack.play(localVideoRef.current)
        }
        console.log('[CallPage] Joined Agora channel successfully')
        setJoined(true)
      } catch (e) {
        // Most likely getUserMedia was denied/unavailable (mic/camera
        // permission) — surfaced here since it otherwise fails silently and
        // just shows a call with no audio/video.
        console.error('[CallPage] Failed to join Agora channel:', e?.message || e)
        // Name the permission plainly instead of showing a generic failure —
        // this is almost always a denied mic/camera prompt, and the user can
        // only fix it if we say which one.
        const denied = /permission|NotAllowed|NotFound|denied/i.test(e?.message || '')
        setJoinError(
          denied
            ? (call.call_type === 'video'
                ? 'Please allow Camera and Microphone access for Famora, then try again'
                : 'Please allow Microphone access for Famora, then try again')
            : (call.call_type === 'video'
                ? 'Could not start camera or microphone'
                : 'Could not start the microphone')
        )
      }
    }
    doJoin()
  }, [call?.status])

  // ── Live call duration ticker ────────────────────────────────────────────
  useEffect(() => {
    if (!call || call.status !== 'accepted') return
    const start = call.answered_at ? new Date(call.answered_at).getTime() : Date.now()
    durationTimer.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(durationTimer.current)
  }, [call?.status, call?.answered_at])

  // ── Call resolved (declined/missed/ended) — leave and navigate back ─────
  useEffect(() => {
    if (!call || endedNavigatedRef.current) return
    if (['declined', 'ended', 'missed'].includes(call.status)) {
      endedNavigatedRef.current = true
      leaveChannel()
      stopNativeCallAlarm()
      stopNativeCallAudio()
      // Kept well under 2s so the call screen never lingers after the call
      // has finished, while still showing the final state (declined /
      // no answer / ended) long enough to read.
      // Go home rather than back: opening a call from the lock screen is a
      // cold start with no previous history entry, so navigate(-1) was a
      // no-op and the finished call screen ("Call ended") stayed on screen
      // indefinitely.
      const t = setTimeout(() => navigate('/', { replace: true }), 1200)
      return () => clearTimeout(t)
    }
  }, [call?.status, navigate])

  // ── Cleanup on unmount — always release the media tracks ────────────────
  useEffect(() => {
    return () => { leaveChannel(); stopNativeCallAudio() }
  }, [])

  const handleAccept = useCallback(async () => {
    await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'accept' })
  }, [callId])

  const handleDecline = useCallback(async () => {
    await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'decline' })
  }, [callId])

  const handleEnd = useCallback(async () => {
    if (ending) return
    setEnding(true)
    await supabase.rpc('end_call', { p_call_id: callId })
  }, [callId, ending])

  useBackButton(true, handleEnd)

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }
  const toggleCamera = () => {
    const next = !cameraOff
    setCameraOff(next)
    setCameraOffState(next)
  }
  const handleFlipCamera = async () => {
    if (flipping) return
    // Flipping while the camera is disabled would silently do nothing — the
    // track has no frames to switch. Turn it back on first so the tap always
    // produces a visible result.
    if (cameraOff) {
      setCameraOff(false)
      setCameraOffState(false)
    }
    // Reopening the camera hardware takes a moment no matter what. Mark the
    // button busy immediately so the tap registers visually instead of looking
    // ignored, which is what makes a slow flip feel broken.
    setFlipping(true)
    try {
      setFacingMode(await switchCamera())
    } finally {
      setFlipping(false)
    }
  }
  const toggleSpeaker = () => {
    const next = !speakerOn
    setNativeSpeakerOn(next)
    setSpeakerOnState(next)
  }

  if (loading || !call) {
    return (
      <div style={styles.page}>
        <div style={styles.center}><div style={styles.name}>Loading…</div></div>
      </div>
    )
  }

  const status = call.status

  return (
    <div style={styles.page}>
      {isVideo && status === 'accepted' && (
        <div ref={remoteVideoRef} style={styles.remoteVideo} />
      )}

      <div style={styles.overlayContent}>
        <div style={styles.header}>
          <div style={styles.avatar}>
            {otherAvatar
              ? <img src={otherAvatar} alt={otherName} style={styles.avatarImg} />
              : (otherName?.[0]?.toUpperCase() || '?')}
          </div>
          <div style={styles.name}>{otherName}</div>
          <div style={styles.status}>
            {status === 'ringing' && isCaller && 'Calling…'}
            {status === 'ringing' && !isCaller && hasPendingAutoAction && 'Connecting…'}
            {status === 'ringing' && !isCaller && !hasPendingAutoAction && `Incoming ${isVideo ? 'video' : 'voice'} call…`}
            {status === 'accepted' && (joinError || formatDuration(elapsed))}
            {status === 'declined' && 'Call declined'}
            {status === 'missed'   && 'No answer'}
            {status === 'ended'    && 'Call ended'}
          </div>
        </div>

        {isVideo && status === 'accepted' && (
          <div ref={localVideoRef} style={styles.localVideo} />
        )}

        <div style={styles.controls}>
          {status === 'ringing' && !isCaller && !hasPendingAutoAction && (
            <>
              <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleDecline} aria-label="Decline">
                <PhoneOffIcon />
              </button>
              <button style={{ ...styles.circleBtn, ...styles.acceptBtn }} onClick={handleAccept} aria-label="Accept">
                <PhoneIcon />
              </button>
            </>
          )}
          {status === 'ringing' && isCaller && (
            <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleEnd} aria-label={t('calls.cancelCall')}>
              <PhoneOffIcon />
            </button>
          )}
          {status === 'accepted' && (
            <>
              {/* Active state = the feature is OFF (muted / camera off), shown as
                  a solid maroon fill. Idle controls stay translucent so the one
                  thing you've switched off is the one thing that stands out. */}
              <button
                style={{ ...styles.smallBtn, ...(muted ? styles.smallBtnActive : null) }}
                onClick={toggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOffIcon /> : <MicIcon />}
              </button>
              <button
                style={{ ...styles.smallBtn, ...(!speakerOn ? styles.smallBtnActive : null) }}
                onClick={toggleSpeaker}
                aria-label={speakerOn ? 'Speaker off' : 'Speaker on'}
              >
                {speakerOn ? <SpeakerIcon /> : <SpeakerOffIcon />}
              </button>
              {isVideo && (
                <>
                  <button
                    style={{ ...styles.smallBtn, ...(cameraOff ? styles.smallBtnActive : null) }}
                    onClick={toggleCamera}
                    aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                  >
                    {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
                  </button>
                  <button
                    style={{ ...styles.smallBtn, opacity: flipping ? 0.45 : 1 }}
                    onClick={handleFlipCamera}
                    disabled={flipping}
                    aria-label={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                  >
                    <FlipCameraIcon />
                  </button>
                </>
              )}
              <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleEnd} aria-label={t('calls.endCall')}>
                <PhoneOffIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: {
    position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #720D35 0%, #2A0414 100%)',
    display: 'flex', flexDirection: 'column', zIndex: 800, color: '#fff', fontFamily: 'inherit',
  },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  remoteVideo: { position: 'absolute', inset: 0, background: '#000' },
  localVideo: {
    position: 'absolute', bottom: 140, right: 20, width: 110, height: 150,
    borderRadius: 16, overflow: 'hidden', background: '#000', border: '2px solid rgba(255,255,255,0.3)',
  },
  overlayContent: {
    flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: '60px 24px 48px', position: 'relative', zIndex: 1,
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  avatar: {
    width: 88, height: 88, borderRadius: '50%', background: 'rgba(255,255,255,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 34, fontWeight: 800, marginBottom: 8, overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' },
  name: { fontFamily: 'Sora, sans-serif', fontSize: 24, fontWeight: 900 },
  status: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: 500 },
  // Five buttons at the old 24px gap measured wider than a 360dp screen once
  // the flip button was added. Flex resolved the overflow by shrinking widths
  // while the fixed heights held, which is what turned the circles into
  // vertical ovals. Tighter gap to fit, flexShrink:0 on the buttons so they
  // can never be squashed again, and wrap as a safety net on very narrow
  // screens — a second row beats deformed buttons.
  controls: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 12, flexWrap: 'wrap', rowGap: 12,
  },
  // display:flex + centring on every button — an inline SVG does not centre in
  // a round button the way a text glyph did, so this replaces the font-size
  // based alignment the emoji relied on.
  circleBtn: {
    width: 58, height: 58, minWidth: 58, minHeight: 58, flexShrink: 0,
    boxSizing: 'border-box', padding: 0,
    borderRadius: '50%', border: 'none', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
  },
  // Answer and hang up keep green/red rather than taking the maroon theme:
  // they are the irreversible actions on this screen, and the colour
  // convention is what makes them readable at a glance mid-call.
  acceptBtn: { background: '#16A34A', boxShadow: '0 6px 20px rgba(22,163,74,0.45)' },
  endBtn:    { background: '#DC2626', boxShadow: '0 6px 20px rgba(220,38,38,0.45)' },
  smallBtn: {
    width: 48, height: 48, minWidth: 48, minHeight: 48, flexShrink: 0,
    boxSizing: 'border-box', padding: 0,
    borderRadius: '50%',
    border: '1.5px solid rgba(255,255,255,0.28)',
    background: 'rgba(149,19,69,0.45)',          // maroon glass over the gradient
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#fff',
    backdropFilter: 'blur(6px)',
    transition: 'background 0.18s, border-color 0.18s',
  },
  smallBtnActive: {
    background: '#951345',
    borderColor: 'rgba(255,255,255,0.75)',
    boxShadow: '0 4px 14px rgba(149,19,69,0.55)',
  },
}
