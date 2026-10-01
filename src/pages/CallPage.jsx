import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useNicknames } from '../hooks/useNicknames'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import { joinChannel, leaveChannel, setMuted, setCameraOff, switchCamera } from '../lib/agora'
import { shouldLeave, callClock, ringingLegs, addableMembers, isFull, participantSummary } from '../lib/conference'
import AddToCallSheet from '../components/AddToCallSheet'
import {
  MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon,
  VideoIcon, VideoOffIcon, FlipCameraIcon, PhoneIcon, PhoneOffIcon, UserPlusIcon,
} from '../components/CallIcons'
import { stopNativeCallAlarm } from '../lib/nativeCallAlarm'
import { startNativeCallAudio, setNativeSpeakerOn, stopNativeCallAudio,
         startCallRingback, stopCallRingback } from '../lib/nativeCallAudio'

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
  const { nameFor } = useNicknames()
  // Held in a ref: the loader below runs once per call and must not re-run
  // just because the nickname map changed identity on a re-render.
  const nameForRef = useRef(nameFor)
  nameForRef.current = nameFor
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

  // ── Conference ──────────────────────────────────────────────────────────
  // A call is still one row per pair. Adding a person creates another row on
  // the same Agora channel (see lib/conference.js and the 20260929160000
  // migration), so this screen holds its own row plus the other rows of the
  // channel it can see, and asks the server who else is in the call.
  const [legs, setLegs]                   = useState([])
  const [participants, setParticipants]   = useState([])
  const [confSupported, setConfSupported] = useState(true)  // false when the migration is not applied yet
  const [showAdd, setShowAdd]             = useState(false)
  const [addBusyId, setAddBusyId]         = useState(null)
  const [members, setMembers]             = useState([])
  const [notice, setNotice]               = useState('')

  const localVideoRef  = useRef(null)
  // Where the person has dragged their self-view to. null = the default corner.
  const [pipPos, setPipPos] = useState(null)
  const pipDrag = useRef(null)
  const remoteVideoRef = useRef(null)
  const noAnswerTimer  = useRef(null)
  const durationTimer  = useRef(null)
  const joinedRef      = useRef(false)
  const endedNavigatedRef = useRef(false)
  const remoteTilesRef = useRef(new Map())        // Agora uid -> that person's video tile
  const refreshParticipantsRef = useRef(() => {})
  const legsRef        = useRef([])
  const prevLegsRef    = useRef(new Map())
  const terminalCheckedRef = useRef(false)
  const goHomeTimerRef = useRef(null)
  const noticeTimerRef = useRef(null)
  const knownNamesRef  = useRef({})               // user id -> display name, for notices
  legsRef.current = legs

  const isCaller = call && user && call.caller_id === user.id
  const isVideo  = call?.call_type === 'video'
  // My own row, unless I am still connected through another one.
  const clock = callClock(call, legs, user?.id)

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
        // The name from their family card if I set one there.
        setOtherName(nameForRef.current(otherId, member?.display_name) || t('messages.member'))
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

  // ── Caller: ringback while the callee's phone is ringing ────────────────
  // An outgoing call was completely silent until it connected, so there was
  // nothing to tell the caller it was ringing rather than dead. Its own effect
  // alongside the timer above rather than part of it: the tone has to stop the
  // moment the status leaves 'ringing' — answered, declined or no answer — and
  // when the screen goes away, both of which this cleanup covers.
  useEffect(() => {
    if (!call || !isCaller || call.status !== 'ringing') return
    startCallRingback(isVideo)
    return () => { stopCallRingback() }
  }, [call?.id, call?.status, isCaller, isVideo])

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
          // supabase-js collapses every non-2xx into the same opaque
          // "returned a non-2xx status code", which cannot tell apart the
          // failures that matter here: missing Agora secrets (500), a row RLS
          // will not show us (404), an expired session (401), or a call that
          // finished while we were asking (409). The Response it carries has
          // the status and body, so read them off it.
          let detail = ''
          try {
            const res = error?.context
            if (res?.status) detail = ` [HTTP ${res.status}] ${await res.text()}`
          } catch (e) {}
          console.error('[CallPage] Failed to get Agora token:', (error?.message || 'no token in response') + detail)
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
              let tile = remoteTilesRef.current.get(remoteUser.uid)
              if (!tile) {
                tile = document.createElement('div')
                tile.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#000'
                remoteTilesRef.current.set(remoteUser.uid, tile)
                remoteVideoRef.current.appendChild(tile)
                layoutRemoteTiles()
              }
              remoteUser.videoTrack?.play(tile)
            } else if (mediaType === 'audio') {
              remoteUser.audioTrack?.play()
            }
            refreshParticipantsRef.current()
          },
          onRemoteLeft: (remoteUser) => {
            const tile = remoteTilesRef.current.get(remoteUser.uid)
            if (tile) { tile.remove(); remoteTilesRef.current.delete(remoteUser.uid); layoutRemoteTiles() }
            refreshParticipantsRef.current()
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
    if (clock.status !== 'accepted') return
    const start = clock.since ? new Date(clock.since).getTime() : Date.now()
    durationTimer.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(durationTimer.current)
  }, [clock.status, clock.since])

  // ── Call resolved (declined/missed/ended) — leave and navigate back ─────
  useEffect(() => {
    if (!call || endedNavigatedRef.current) return
    if (!['declined', 'ended', 'missed'].includes(call.status)) return
    let cancelled = false

    const finish = () => {
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
      goHomeTimerRef.current = setTimeout(() => navigate('/', { replace: true }), 1200)
    }

    // My own row is over. In a conference I may still be connected through
    // another row, so leave only when nothing else holds me here. The rows are
    // read once more first, so a leg that changed a moment ago is not missed.
    const decide = async () => {
      let current = legsRef.current
      if (!terminalCheckedRef.current && call.agora_channel_name) {
        terminalCheckedRef.current = true
        try {
          const { data } = await supabase.from('calls').select('*')
            .eq('agora_channel_name', call.agora_channel_name)
          if (data) { current = data; setLegs(data) }
        } catch { /* fall back to the rows already held */ }
      }
      if (cancelled) return
      if (shouldLeave(call, current, user?.id)) finish()
    }
    decide()
    return () => { cancelled = true }
  }, [call?.status, legs, navigate])

  // ── Cleanup on unmount — always release the media tracks ────────────────
  useEffect(() => {
    return () => {
      leaveChannel(); stopNativeCallAudio()
      clearTimeout(goHomeTimerRef.current); clearTimeout(noticeTimerRef.current)
    }
  }, [])

  // ── Conference: the other rows of this call's channel ───────────────────
  const channelName = call?.agora_channel_name
  useEffect(() => {
    if (!channelName || !user?.id) return
    let cancelled = false
    const merge = (row) => setLegs(prev => {
      const i = prev.findIndex(l => l.id === row.id)
      if (i === -1) return [...prev, row]
      const next = prev.slice(); next[i] = row; return next
    })
    supabase.from('calls').select('*').eq('agora_channel_name', channelName)
      .then(({ data }) => { if (!cancelled && data) setLegs(data) })
    const ch = supabase
      .channel(`callchan:${channelName}:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls',
        filter: `agora_channel_name=eq.${channelName}` }, (p) => { if (!cancelled && p.new) merge(p.new) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls',
        filter: `agora_channel_name=eq.${channelName}` }, (p) => { if (!cancelled && p.new) merge(p.new) })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [channelName, user?.id])

  // ── Conference: who is in the call ──────────────────────────────────────
  // A person only sees their own rows, so who else joined through somebody
  // else comes from the server. Refreshed on a timer and whenever Agora
  // reports someone arriving or leaving.
  useEffect(() => {
    if (!call?.id || clock.status !== 'accepted' || !confSupported) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc('get_call_participants', { p_call_id: call.id })
      if (cancelled) return
      if (error) {
        // The function does not exist: the app is newer than the database.
        if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) {
          setConfSupported(false)
        }
        return
      }
      const rows = data || []
      rows.forEach(p => { if (p.participant_name) knownNamesRef.current[p.participant_id] = p.participant_name })
      setParticipants(rows)
    }
    refreshParticipantsRef.current = load
    load()
    const timer = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(timer); refreshParticipantsRef.current = () => {} }
  }, [call?.id, clock.status, confSupported])

  const flash = (msg) => {
    setNotice(msg)
    clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNotice(''), 4000)
  }
  const personName = (id) => nameForRef.current(id, knownNamesRef.current[id]) || t('messages.member')

  // ── Conference: give up on someone I added who does not answer ──────────
  const ringingLegKey = ringingLegs(call, legs, user?.id).map(l => l.id).join(',')
  useEffect(() => {
    if (!ringingLegKey) return
    const timers = ringingLegs(call, legsRef.current, user?.id).map(l => {
      const left = Math.max(1000, CALLER_NO_ANSWER_MS - (Date.now() - new Date(l.started_at).getTime()))
      return setTimeout(() => { supabase.rpc('mark_call_missed', { p_call_id: l.id }) }, left)
    })
    return () => timers.forEach(clearTimeout)
  }, [ringingLegKey]) // the rows themselves are read from legsRef, which always holds the latest

  // ── Conference: tell me when someone I added does not join ──────────────
  useEffect(() => {
    const prev = prevLegsRef.current
    legs.forEach(l => {
      if (l.caller_id !== user?.id || l.id === call?.id) return
      if (prev.get(l.id) === 'ringing' && (l.status === 'declined' || l.status === 'missed')) {
        flash(t('calls.didntJoin', { name: personName(l.callee_id) }))
      }
    })
    prevLegsRef.current = new Map(legs.map(l => [l.id, l.status]))
  }, [legs])

  // Remote video: one tile per person, so a conference shows everyone. With a
  // single remote the one tile fills the screen, as before.
  const layoutRemoteTiles = () => {
    const box = remoteVideoRef.current
    if (!box) return
    const n = remoteTilesRef.current.size
    box.style.display = 'grid'
    box.style.gridAutoRows = '1fr'
    box.style.gridTemplateColumns = n > 2 ? '1fr 1fr' : '1fr'
  }

  const openAdd = async () => {
    setShowAdd(true)
    refreshParticipantsRef.current()
    if (members.length === 0 && call?.family_id) {
      const { data } = await supabase.from('family_members')
        .select('user_id, display_name, avatar_url').eq('family_id', call.family_id)
      if (data) {
        data.forEach(m => { if (m.display_name) knownNamesRef.current[m.user_id] = m.display_name })
        setMembers(data)
      }
    }
  }

  const handlePickPerson = async (personId) => {
    if (addBusyId || !call) return
    setAddBusyId(personId)
    const { data, error } = await supabase.rpc('add_call_participant', { p_call_id: call.id, p_callee_id: personId })
    setAddBusyId(null)
    setShowAdd(false)
    if (error) {
      console.error('Add to call error:', error.code || error.message)
      flash(/full/i.test(error.message || '') ? t('calls.callFull') : t('calls.addFailed'))
      return
    }
    if (data?.id) setLegs(prev => prev.some(l => l.id === data.id) ? prev : [...prev, data])
    refreshParticipantsRef.current()
  }

  const handleAccept = useCallback(async () => {
    const { error } = await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'accept' })
    if (error) console.error('Accept call error:', error.code || 'unknown')
  }, [callId])

  const handleDecline = useCallback(async () => {
    const { error } = await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'decline' })
    if (error) console.error('Decline call error:', error.code || 'unknown')
  }, [callId])

  const handleEnd = useCallback(async () => {
    if (ending) return
    setEnding(true)
    let { error } = await supabase.rpc('leave_call', { p_call_id: callId })
    // The app is newer than the database (migration not applied yet): hang up the old way.
    if (error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || ''))) {
      ({ error } = await supabase.rpc('end_call', { p_call_id: callId }))
    }
    // Let the guard go again on failure. `ending` was the only thing standing
    // between the user and a second attempt, so leaving it set after a failed
    // call left them with a dead End button — and useBackButton routes the
    // back gesture here too, so there was no way out of the screen at all.
    if (error) {
      console.error('End call error:', error.code || 'unknown')
      setEnding(false)
    }
  }, [callId, ending])

  useBackButton(true, handleEnd)
  useBackButton(showAdd, () => setShowAdd(false))

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
        <div style={styles.center}><div style={styles.name}>{t('common.loading')}</div></div>
      </div>
    )
  }

  const status = clock.status
  const others = participants.filter(p => p.participant_id !== user?.id && p.participant_state === 'in')
  const summary = others.length >= 2
    ? participantSummary(participants, user?.id, nameFor, t('messages.member')) : ''
  const ringingNames = ringingLegs(call, legs, user?.id).map(l => personName(l.callee_id))
  const addable = addableMembers(members, participants, user?.id)
  const pipDown = e => {
    const r = e.currentTarget.getBoundingClientRect()
    pipDrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const pipMove = e => {
    const d = pipDrag.current
    if (!d) return
    const m = 8   // keep it fully on screen
    const x = Math.min(Math.max(e.clientX - d.dx, m), window.innerWidth  - d.w - m)
    const y = Math.min(Math.max(e.clientY - d.dy, m), window.innerHeight - d.h - m)
    setPipPos({ x, y })
  }
  const pipUp = () => { pipDrag.current = null }
  const canAdd = confSupported && !isFull(participants)
  // Up to four buttons keep their full size. A fifth (video call with Add) shrinks
  // them to fit a 360dp screen in one row rather than wrapping or squashing them.
  const fnCount = 2 + (isVideo ? 2 : 0) + (canAdd ? 1 : 0)
  const fnSize = fnCount >= 5 ? 'min(64px, 15vw)' : 64
  const fnBtn = extra => ({ ...styles.smallBtn, width: fnSize, height: fnSize, minWidth: 0, minHeight: 0, ...extra })

  return (
    <div style={styles.page}>
      {isVideo && status === 'accepted' && (
        <div ref={remoteVideoRef} style={styles.remoteVideo} />
      )}

      {showAdd && (
        <AddToCallSheet people={addable} busyId={addBusyId} nameFor={nameFor}
          onPick={handlePickPerson} onClose={() => setShowAdd(false)} />
      )}

      <div style={styles.overlayContent}>
        <div style={styles.header}>
          <div style={styles.avatar}>
            {otherAvatar
              ? <img src={otherAvatar} alt={otherName} style={styles.avatarImg} />
              : (otherName?.[0]?.toUpperCase() || '?')}
          </div>
          <div style={styles.name}>{summary || otherName}</div>
          <div style={styles.status}>
            {status === 'ringing' && isCaller && 'Calling…'}
            {status === 'ringing' && !isCaller && hasPendingAutoAction && 'Connecting…'}
            {status === 'ringing' && !isCaller && !hasPendingAutoAction && `Incoming ${isVideo ? 'video' : 'voice'} call…`}
            {status === 'accepted' && (joinError || formatDuration(elapsed))}
            {status === 'declined' && 'Call declined'}
            {status === 'missed'   && 'No answer'}
            {status === 'ended'    && 'Call ended'}
          </div>
          {ringingNames.map((n, i) => (
            <div key={i} style={styles.chip}>{t('calls.callingName', { name: n })}</div>
          ))}
          {notice && <div style={styles.chip}>{notice}</div>}
        </div>

        {isVideo && status === 'accepted' && (
          <div
            ref={localVideoRef}
            style={pipPos ? { ...styles.localVideo, top: pipPos.y, left: pipPos.x, right: 'auto' } : styles.localVideo}
            onPointerDown={pipDown} onPointerMove={pipMove} onPointerUp={pipUp} onPointerCancel={pipUp}
          />
        )}

        <div style={status === 'accepted' ? styles.controlsCol : styles.controls}>
          {status === 'ringing' && !isCaller && !hasPendingAutoAction && (
            <>
              <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleDecline} aria-label="Decline">
                <PhoneOffIcon size={34} />
              </button>
              <button style={{ ...styles.circleBtn, ...styles.acceptBtn }} onClick={handleAccept} aria-label="Accept">
                <PhoneIcon size={34} />
              </button>
            </>
          )}
          {status === 'ringing' && isCaller && (
            <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleEnd} aria-label={t('calls.cancelCall')}>
              <PhoneOffIcon size={34} />
            </button>
          )}
          {status === 'accepted' && (
            <>
              <div style={styles.fnRow}>
              {/* Active state = the feature is OFF (muted / camera off), shown as
                  a solid maroon fill. Idle controls stay translucent so the one
                  thing you've switched off is the one thing that stands out. */}
              <button
                style={fnBtn(muted ? styles.smallBtnActive : null)}
                onClick={toggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOffIcon size={28} /> : <MicIcon size={28} />}
              </button>
              <button
                style={fnBtn(!speakerOn ? styles.smallBtnActive : null)}
                onClick={toggleSpeaker}
                aria-label={speakerOn ? 'Speaker off' : 'Speaker on'}
              >
                {speakerOn ? <SpeakerIcon size={28} /> : <SpeakerOffIcon size={28} />}
              </button>
              {isVideo && (
                <>
                  <button
                    style={fnBtn(cameraOff ? styles.smallBtnActive : null)}
                    onClick={toggleCamera}
                    aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                  >
                    {cameraOff ? <VideoOffIcon size={28} /> : <VideoIcon size={28} />}
                  </button>
                  <button
                    style={fnBtn({ opacity: flipping ? 0.45 : 1 })}
                    onClick={handleFlipCamera}
                    disabled={flipping}
                    aria-label={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                  >
                    <FlipCameraIcon size={28} />
                  </button>
                </>
              )}
              {canAdd && (
                <button style={fnBtn()} onClick={openAdd} aria-label={t('calls.addPerson')}>
                  <UserPlusIcon size={28} />
                </button>
              )}
              </div>
              <button style={{ ...styles.circleBtn, ...styles.endBtn }} onClick={handleEnd} aria-label={t('calls.endCall')}>
                <PhoneOffIcon size={34} />
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
    position: 'fixed', inset: 0, background: 'linear-gradient(160deg, var(--maroon-deep) 0%, #2A0414 100%)',
    display: 'flex', flexDirection: 'column', zIndex: 800, color: '#fff', fontFamily: 'inherit',
  },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  remoteVideo: { position: 'absolute', inset: 0, background: '#000' },
  localVideo: {
    // Top right, clear of the button rows. At the bottom right it sat behind them.
    position: 'absolute', top: 44, right: 16, width: 100, height: 134,
    borderRadius: 16, overflow: 'hidden', background: '#000', border: '2px solid rgba(255,255,255,0.3)',
    // Draggable: stop the browser reading a drag on it as a page scroll or a text selection.
    touchAction: 'none', userSelect: 'none', cursor: 'grab', zIndex: 2,
  },
  overlayContent: {
    flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: '60px 24px 48px', position: 'relative', zIndex: 1,
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  // Short line under the status: who is being called, or who did not join.
  chip: {
    fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
    background: 'rgba(255,255,255,0.12)', borderRadius: 999, padding: '5px 12px',
  },
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
    gap: 56,   // Decline and Accept sit well apart so a thumb cannot hit the wrong one
  },
  // Answered call: the function buttons in one row, the End button alone
  // beneath it. Two rows leave room for bigger buttons than one crowded row of
  // five could, and put the irreversible action where a thumb rests.
  controlsCol: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26,
  },
  fnRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10, flexWrap: 'wrap', rowGap: 14,
  },
  // display:flex + centring on every button — an inline SVG does not centre in
  // a round button the way a text glyph did, so this replaces the font-size
  // based alignment the emoji relied on.
  circleBtn: {
    width: 76, height: 76, minWidth: 76, minHeight: 76, flexShrink: 0,
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
    width: 64, height: 64, minWidth: 64, minHeight: 64, flexShrink: 0,
    boxSizing: 'border-box', padding: 0,
    borderRadius: '50%',
    border: '1.5px solid rgba(255,255,255,0.28)',
    background: 'rgba(139,13,61,0.45)',          // maroon glass over the gradient
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#fff',
    backdropFilter: 'blur(6px)',
    transition: 'background 0.18s, border-color 0.18s',
  },
  smallBtnActive: {
    background: 'var(--maroon)',
    borderColor: 'rgba(255,255,255,0.75)',
    boxShadow: '0 4px 14px rgba(139,13,61,0.55)',
  },
}
