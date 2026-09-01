import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'
import { useT } from '../i18n'
import CallsPanel from '../components/CallsPanel'
import { useHiddenMessages } from '../hooks/useHiddenMessages'
import { readMuteLevel, writeMuteLevel, MUTE_LEVELS } from '../lib/muteLevel'
import PersonalChatPanel from '../components/PersonalChatPanel'
import {
  SingleTick, DoubleTick, ReplyBar, ReplyQuote, MessageActionSheet, EditModal,
  ReactionChips,
} from '../components/MessageActions'
import { AttachButton, MediaBubble, PendingMediaBar, VoiceRecorder } from '../components/ChatMedia'
import { useNicknames } from '../hooks/useNicknames'
import { useReactions } from '../hooks/useReactions'
import { familyMediaFolder, uploadChatMedia } from '../lib/chatMedia'

const MessagesPageNative = registerPlugin('MessagesPage')
function notifyNativePageOpen(open) {
  if (!Capacitor.isNativePlatform()) return
  try { MessagesPageNative.setOpen({ open }) } catch (e) {}
}
function setNativeMuteLevel(level) {
  if (!Capacitor.isNativePlatform()) return
  try { MessagesPageNative.setMuteLevel({ level }) } catch (e) {}
}

export default function MessagesPage() {
  const t = useT()
  const navigate = useNavigate()
  const { user, familyId } = useAuthStore()
  const { hidden: hiddenMsgs, hide: hideMessage, hideMany } = useHiddenMessages('family', user?.id)
  // The private name I have given each member — the same one shown on their
  // family card. Without this the chat labelled everyone by the name they
  // registered with, whatever the card said.
  const { nameFor } = useNicknames()
  const { reactions, react } = useReactions('family', familyId, user?.id)
  const [messages, setMessages]   = useState([])
  const [members, setMembers]     = useState({})
  const [msgsLoaded, setMsgsLoaded] = useState(false)
  const [reads, setReads]         = useState({})
  const [detailMsg, setDetailMsg] = useState(null)   // read-info popup
  const [actionAnchor, setActionAnchor] = useState(null)
  const [actionMsg, setActionMsg] = useState(null)   // long-press action sheet
  const [editMsg, setEditMsg]     = useState(null)   // edit modal
  const [replyTo, setReplyTo]     = useState(null)   // message being replied to
  const [text, setText]           = useState('')
  const [pendingMedia, setPendingMedia] = useState(null)  // { file, kind, durationMs, previewUrl }
  const [sending, setSending]     = useState(false)
  const [clearing, setClearing]   = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [muteLevel, setMuteLevel] = useState(readMuteLevel)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch]   = useState(false)
  const [dialog, setDialog]           = useState(null) // { type, title, message, onConfirm }
  // 'chat' = family-wide room, 'personal' = one-to-one threads, 'calls' = history
  const [activeTab, setActiveTab]     = useState('chat')
  // Bumped when the Personal tab is tapped while already open — closes an
  // open thread, which is how you get back to the list now that the header
  // has no back arrow (hardware back does the same on Android).
  const [personalReset, setPersonalReset] = useState(0)
  const [callControls, setCallControls] = useState(null) // reported by CallsPanel
  const [personalControls, setPersonalControls] = useState(null) // reported by PersonalChatPanel
  const [typingUsers, setTypingUsers] = useState({})
  const bottomRef      = useRef(null)
  const longPressRef   = useRef(null)
  const didLongPress   = useRef(false)
  const typingTimerRef = useRef(null)
  const typingChRef    = useRef(null)

  useEffect(() => {
    notifyNativePageOpen(true)
    // Sync current mute level to native on mount
    setNativeMuteLevel(muteLevel)
    return () => notifyNativePageOpen(false)
  }, [])

  const otherMemberCount = Math.max(0, Object.keys(members).length - 1)

  // What is actually on screen. Messages hidden for me — one "Delete for me",
  // or a Clear Chat — are still in `messages`, so counting that array would
  // leave an empty room claiming to have history and still offering to clear
  // it.
  const visibleMessages = messages.filter(m => !hiddenMsgs.has(m.id))

  // Every name shown on this page goes through here: my nickname for that
  // person if I set one, otherwise the name they chose for themselves.
  const memberName = (uid, fallback) =>
    nameFor(uid, members[uid]?.display_name || fallback)

  const loadReads = async () => {
    if (!familyId) return
    const { data } = await supabase.from('message_reads')
      .select('message_id, user_id, read_at').eq('family_id', familyId)
    if (data) {
      const map = {}
      data.forEach(r => {
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push({ user_id: r.user_id, read_at: r.read_at })
      })
      setReads(map)
    }
  }

  const reloadMessages = async () => {
    if (!familyId) return
    const [memRes, msgRes] = await Promise.all([
      supabase.from('family_members').select('user_id, display_name, avatar_color, avatar_url').eq('family_id', familyId),
      supabase.from('messages').select('*').eq('family_id', familyId).order('created_at', { ascending: true }),
    ])
    if (memRes.data) {
      const map = {}
      memRes.data.forEach(m => { map[m.user_id] = m })
      setMembers(map)
    }
    if (msgRes.data) setMessages(msgRes.data)
    await loadReads()
  }

  useEffect(() => {
    if (!familyId) return
    supabase.from('family_members').select('user_id, display_name, avatar_color, avatar_url')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) { const map = {}; data.forEach(m => { map[m.user_id] = m }); setMembers(map) }
      })
  }, [familyId])

  useEffect(() => {
    // No family to read from. The fetch below is what flips msgsLoaded, so
    // returning early left the skeleton bubbles shimmering forever — the page
    // looked like it was still loading a room that does not exist. Marking it
    // loaded hands over to the empty state below.
    if (!familyId) { setMsgsLoaded(true); return }
    supabase.from('messages').select('*').eq('family_id', familyId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setMessages(data); setMsgsLoaded(true) })

    const markReadIfVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      supabase.rpc('mark_messages_read', { p_family_id: familyId })
        .then(({ error }) => { if (!error) loadReads() })
    }
    loadReads()
    markReadIfVisible()
    const onVisible = () => { if (!document.hidden) markReadIfVisible() }
    document.addEventListener('visibilitychange', onVisible)

    const channel = supabase.channel(`messages:${familyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `family_id=eq.${familyId}` },
        (payload) => {
          setMessages(prev => [...prev, payload.new])
          if (payload.new.user_id !== user.id) markReadIfVisible()
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `family_id=eq.${familyId}` },
        (payload) => {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m))
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `family_id=eq.${familyId}` },
        () => {
          supabase.from('messages').select('*').eq('family_id', familyId)
            .order('created_at', { ascending: true })
            .then(({ data }) => setMessages(data || []))
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads', filter: `family_id=eq.${familyId}` },
        (payload) => {
          const r = payload.new
          setReads(prev => {
            const list = prev[r.message_id] ? [...prev[r.message_id]] : []
            if (!list.some(x => x.user_id === r.user_id)) list.push({ user_id: r.user_id, read_at: r.read_at })
            return { ...prev, [r.message_id]: list }
          })
        })
      .subscribe()

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [familyId])

  // Clear the typing throttle timer on unmount to prevent the leak
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!familyId || !user) return
    const ch = supabase.channel(`typing:${familyId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.user_id === user.id) return
        setTypingUsers(prev => ({ ...prev, [payload.user_id]: Date.now() }))
        setTimeout(() => {
          setTypingUsers(prev => {
            const u = { ...prev }
            if (Date.now() - (u[payload.user_id] || 0) >= 2900) delete u[payload.user_id]
            return u
          })
        }, 3000)
      }).subscribe()
    typingChRef.current = ch
    return () => supabase.removeChannel(ch)
  }, [familyId, user])

  // The first paint of a loaded thread jumps straight to the newest message.
  // Animating it meant watching the whole history scroll past on every visit
  // to the page; later arrivals still slide in so the movement is noticed.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (!messages.length) return
    bottomRef.current?.scrollIntoView({
      behavior: didInitialScroll.current ? 'smooth' : 'instant',
    })
    didInitialScroll.current = true
  }, [messages])

  // An attachment is a message on its own, so either a caption or a file is
  // enough to send.
  const canSend = !!text.trim() || !!pendingMedia

  // Revoking the object URL matters here: an image preview holds the whole
  // file in memory until it is released, and people browse several before
  // settling on one.
  const clearPendingMedia = () => {
    setPendingMedia(prev => {
      if (prev?.previewUrl) { try { URL.revokeObjectURL(prev.previewUrl) } catch (e) {} }
      return null
    })
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!canSend || sending) return
    setSending(true)

    // Uploaded as part of sending rather than at pick time: a message that is
    // never sent then leaves nothing behind in storage.
    let media = null
    if (pendingMedia) {
      try {
        media = await uploadChatMedia(familyMediaFolder(familyId, user.id), pendingMedia.file)
      } catch (err) {
        setSending(false)
        setDialog({
          type: 'error',
          message: err?.message === 'too-big' ? t('messages.mediaTooBig')
            : err?.message === 'unsupported' ? t('messages.mediaUnsupported')
            : t('messages.mediaUploadFailed'),
        })
        return
      }
    }

    let { error } = await supabase.rpc('send_message', {
      p_family_id:        familyId,
      p_content:          text.trim(),
      p_reply_to_id:      replyTo?.id || null,
      p_media_path:       media?.path || null,
      p_media_type:       media?.type || null,
      p_media_mime:       media?.mime || null,
      p_media_size:       media?.size || null,
      p_media_name:       media?.name || null,
      p_media_duration_ms: pendingMedia?.durationMs ? Math.round(pendingMedia.durationMs) : null,
    })

    // PGRST202 is "no function with these arguments". It means this build is
    // running against a database where the attachment migration has not been
    // applied yet — during a rollout, or on a phone updated ahead of the
    // server. A plain text message still works there, and silently failing to
    // send one would be a far worse bug than not being able to attach a photo.
    if (error?.code === 'PGRST202' && !media) {
      ;({ error } = await supabase.rpc('send_message', {
        p_family_id:   familyId,
        p_content:     text.trim(),
        p_reply_to_id: replyTo?.id || null,
      }))
    }
    if (error) {
      setDialog({ type: 'error', message: t('messages.sendFailed') })
    } else {
      setText('')
      setReplyTo(null)
      clearPendingMedia()
    }
    setSending(false)
  }

  // ── Edit ────────────────────────────────────────────────────────────────────
  const handleEdit = async (msgId, newContent) => {
    const { error } = await supabase.rpc('edit_message', {
      p_message_id:  msgId,
      p_new_content: newContent,
    })
    if (error) setDialog({ type: 'error', message: t('messages.editFailed') })
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = (msg) => {
    setDialog({
      type: 'confirm',
      title: t('messages.deleteTitle'),
      message: t('messages.deleteMsg'),
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        const { error } = await supabase.rpc('delete_message', { p_message_id: msg.id })
        if (error) setDialog({ type: 'error', message: t('messages.deleteFailed') })
        else setMessages(prev => prev.filter(m => m.id !== msg.id))
      },
    })
  }

  // ── Clear chat ──────────────────────────────────────────────────────────────
  // Clears the room for ME. It used to delete every row in the family, so one
  // person tidying their screen wiped the history off everyone's phone — in a
  // shared room that is destroying other people's messages, not housekeeping.
  // The private threads keep the old meaning: see PersonalChatPanel.
  const handleClearMessages = () => {
    setDialog({
      type: 'confirm',
      title: t('messages.clearTitle'),
      message: t('messages.clearMsg'),
      confirmLabel: t('messages.clearChat'),
      onConfirm: async () => {
        setClearing(true)
        const { data, error } = await supabase.rpc('clear_family_chat_for_me', {
          p_family_id: familyId,
        })
        setClearing(false)
        if (error) { setDialog({ type: 'error', message: t('messages.clearFailed') }); return }
        // The RPC returns the ids it hid, so nothing has to be re-read; the
        // messages stay in state and are filtered out by the hidden set.
        hideMany((data || []).map(row => (typeof row === 'string' ? row : row.id)))
      },
    })
  }

  // Pull-to-refresh only arms once the list is scrolled to its very top, and
  // these lists are anchored at the BOTTOM: refreshing meant dragging the whole
  // history up first. The header offers it directly instead, for whichever tab
  // is open. The Map screen already has the same control.
  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (activeTab === 'personal') await personalControls?.reload?.()
      else if (activeTab === 'calls') await callControls?.reload?.()
      else await reloadMessages()
    } catch (e) {
      // A failed refresh leaves what is already on screen; the realtime
      // channels keep it current anyway, so this is a convenience, not a
      // dependency.
    } finally {
      setRefreshing(false)
    }
  }

  const handleTextChange = (e) => {
    setText(e.target.value)
    if (!typingTimerRef.current && typingChRef.current) {
      typingChRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: user?.id } })
      typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null }, 1000)
    }
  }

  // ── Mute ────────────────────────────────────────────────────────────────────
  const handleMuteToggle = () => {
    const next = writeMuteLevel((muteLevel + 1) % MUTE_LEVELS)
    setMuteLevel(next)
    setNativeMuteLevel(next)
  }
  const MUTE_STATES = [
    { tip: t('messages.notificationsOn') },
    { tip: t('messages.soundMuted') },
    { tip: t('messages.allMuted') },
  ]
  // Never index blind — an unexpected stored level must not take the page down
  const muteState = MUTE_STATES[muteLevel] || MUTE_STATES[0]
  const MUTE_COLOR = muteLevel === 1 ? 'var(--gold)' : muteLevel === 2 ? 'var(--rose)' : '#fff'

  // ── Long press ──────────────────────────────────────────────────────────────
  const startLongPress = (msg, e) => {
    didLongPress.current = false
    // The rect is read here, not inside the timeout: React nulls
    // currentTarget once the handler returns, so by the time the long press
    // fires there is nothing left to measure.
    const rect = e?.currentTarget?.getBoundingClientRect?.() ?? null
    longPressRef.current = setTimeout(() => {
      didLongPress.current = true
      try { if (navigator.vibrate) navigator.vibrate(40) } catch (e) {}
      setActionAnchor(rect)
      setActionMsg(msg)
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current)
  }

  // Redial from the call history. Mirrors handleStartCall on the family screen:
  // create_call resolves the caller from auth.uid() server-side, so only the
  // callee and type are passed.
  const handleQuickCall = async (calleeId, callType) => {
    if (!familyId || !calleeId) return
    const { data, error } = await supabase.rpc('create_call', {
      p_family_id: familyId,
      p_callee_id: calleeId,
      p_call_type: callType,
    })
    if (error) { setDialog({ type: 'error', message: error.message }); return }
    navigate(`/call/${data.id}`)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top Bar */}
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="top-bar-title">💬 {t('messages.title')}</div>
            <button onClick={handleMuteToggle} title={muteState.tip} style={{
              marginTop: 3, background: 'none', border: 'none',
              cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke={MUTE_COLOR} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6.5 2.5 7.5a1 1 0 0 1-.7 1.7H4.2a1 1 0 0 1-.7-1.7C4.5 14.5 6 12.5 6 8z"/>
                <path d="M10 20.5a2 2 0 0 0 4 0"/>
                {muteLevel > 0 && <line x1="4" y1="4" x2="20" y2="20"/>}
              </svg>
              {muteLevel > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: MUTE_COLOR }}>
                  {muteLevel === 1 ? t('messages.soundOff') : t('messages.muted')}
                </span>
              )}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {activeTab === 'calls' && callControls?.selectMode && (
            <>
              <button onClick={callControls.cancelSelection} style={{
                background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.3)',
                color: '#fff', borderRadius: 10, padding: '7px 12px',
                fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>Cancel</button>
              <button onClick={callControls.deleteSelected}
                disabled={callControls.busy || callControls.selectedCount === 0} style={{
                background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
                color: '#951345', borderRadius: 10, padding: '7px 12px',
                fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
                Delete ({callControls.selectedCount})
              </button>
            </>
          )}
          {activeTab === 'calls' && !callControls?.selectMode && callControls?.clearableCount > 0 && (
            <button onClick={callControls.clearAll} disabled={callControls.busy} style={{
              background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
              color: '#951345', borderRadius: 10, padding: '7px 12px',
              fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {callControls.busy ? t('messages.clearing') : t('messages.clearCount', { n: callControls.clearableCount })}
            </button>
          )}
          {activeTab === 'chat' && visibleMessages.length > 0 && (
            <button onClick={handleClearMessages} disabled={clearing} style={{
              background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
              color: '#951345', borderRadius: 10, padding: '7px 12px',
              fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {clearing ? t('messages.clearing') : t('messages.clearChat')}
            </button>
          )}
          {/* Same button for an open personal thread. The panel reports the
              action up rather than drawing its own, so the two tabs cannot
              drift apart in style the way they had. */}
          {activeTab === 'personal' && personalControls?.canClear && (
            <button onClick={personalControls.clearThread} disabled={personalControls.clearing} style={{
              background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
              color: '#951345', borderRadius: 10, padding: '7px 12px',
              fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
              cursor: personalControls.clearing ? 'wait' : 'pointer',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {personalControls.clearing ? t('messages.clearing') : t('messages.clearChat')}
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={t('common.retry')}
            aria-label={t('messages.refresh')}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: 10,
              padding: '7px 10px', cursor: refreshing ? 'default' : 'pointer',
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <style>{'@keyframes msgspin{to{transform:rotate(360deg)}}'}</style>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={refreshing ? { animation: 'msgspin 0.8s linear infinite' } : undefined}>
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
          {activeTab === 'chat' && (
          <button onClick={() => setShowSearch(s => !s)} style={{
            background: showSearch ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.15)',
            border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: 10,
            padding: '7px 10px', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={showSearch ? '#951345' : '#fff'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          )}
        </div>
      </div>

      {/* Chat / Personal / Calls tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1.5px solid #F0E4EA', flexShrink: 0 }}>
        {[{ key: 'chat', label: t('messages.tabFamily') }, { key: 'personal', label: t('messages.tabPersonal') }, { key: 'calls', label: t('messages.tabCalls') }].map(tab => (
          <button key={tab.key} onClick={() => {
            if (tab.key === 'personal' && activeTab === 'personal') setPersonalReset(n => n + 1)
            setActiveTab(tab.key)
          }} style={{
            flex: 1, padding: '12px 0', background: 'none', border: 'none',
            borderBottom: activeTab === tab.key ? '2.5px solid #951345' : '2.5px solid transparent',
            color: activeTab === tab.key ? '#951345' : '#9C6B7A',
            fontWeight: activeTab === tab.key ? 800 : 600,
            fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'calls' && (
        <CallsPanel
          onDialog={setDialog}
          onControls={setCallControls}
          onCall={handleQuickCall}
        />
      )}

      {activeTab === 'personal' && <PersonalChatPanel onDialog={setDialog} resetSignal={personalReset} onControls={setPersonalControls} />}

      {activeTab === 'chat' && showSearch && (
        <div style={{ padding: '8px 16px', background: '#F8F7FF', borderBottom: '1px solid #EDE9FF' }}>
          <div style={{ position: 'relative' }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search messages..." autoFocus
              style={{
                width: '100%', padding: '10px 36px 10px 14px',
                borderRadius: 12, border: '1.5px solid #EDE9FF',
                fontSize: 14, fontFamily: 'inherit', outline: 'none',
                background: '#fff', boxSizing: 'border-box',
              }} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9CA3AF',
              }}>✕</button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'chat' && Object.keys(typingUsers).length > 0 && (
        <div style={{ padding: '6px 20px', background: '#F8F7FF', borderBottom: '1px solid #EDE9FF',
          display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED',
                animation: `tdot 1.2s ${i*0.2}s ease-in-out infinite` }} />
            ))}
          </div>
          <style>{`@keyframes tdot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}`}</style>
          <span style={{ fontSize: 12, color: '#7C3AED', fontWeight: 600 }}>
            {Object.keys(typingUsers).length === 1
              ? t('messages.isTyping', { name: memberName(Object.keys(typingUsers)[0], t('messages.someone')) })
              : t('messages.severalTyping')}
          </span>
        </div>
      )}

      {activeTab === 'chat' && (
      <>
      {/* Messages list */}
      <PullToRefresh onRefresh={reloadMessages}>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Skeleton while loading */}
        {!msgsLoaded && (
          <>
            {[70, 50, 80, 45, 65].map((w, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: i % 2 === 0 ? 'row-reverse' : 'row',
                gap: 8, alignItems: 'flex-end',
              }}>
                {i % 2 !== 0 && <div className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />}
                <div className="skeleton skeleton-msg" style={{ width: `${w}%`, height: 44 }} />
              </div>
            ))}
          </>
        )}

        {msgsLoaded && visibleMessages.length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">💬</div>
            <div className="empty-text">{t('messages.noMessages')}</div>
            <div className="empty-sub">{t('messages.sendFirst')}</div>
          </div>
        )}

        {msgsLoaded && searchQuery && visibleMessages.filter(m => m.content?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">🔍</div>
            <div className="empty-text">{t('messages.noResults')}</div>
            <div className="empty-sub">{t('messages.noMatch', { query: searchQuery })}</div>
          </div>
        )}

        {msgsLoaded && (() => {
          let lastDateLabel = null
          // Hidden-for-me messages drop out before search, so a hidden message
          // cannot resurface by matching a query.
          const visible = visibleMessages
          const filtered = searchQuery
            ? visible.filter(m => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
            : visible
          return filtered.map((msg, idx) => {
            const isOwn  = msg.user_id === user?.id
            const member = members[msg.user_id]
            const readCount = (reads[msg.id] || []).length
            const allRead   = otherMemberCount > 0 && readCount >= otherMemberCount
            const someRead  = readCount > 0

            // ── Grouping: hide name/avatar when same sender follows immediately ──
            const prevMsg = filtered[idx - 1]
            const nextMsg = filtered[idx + 1]
            const sameAsPrev = prevMsg && prevMsg.user_id === msg.user_id
            const sameAsNext = nextMsg && nextMsg.user_id === msg.user_id
            // Only show name/avatar on the FIRST bubble in a run
            const showSenderInfo = !sameAsPrev
            // Tighten vertical gap inside a group
            const isGrouped = sameAsPrev || sameAsNext

            // Date separator
            const msgDate = new Date(msg.created_at)
            const today   = new Date()
            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
            const isSameDay = (a, b) => a.toDateString() === b.toDateString()
            let dateLabel = null
            const msgDateStr = msgDate.toDateString()
            if (msgDateStr !== lastDateLabel) {
              lastDateLabel = msgDateStr
              if (isSameDay(msgDate, today)) dateLabel = t('messages.today')
              else if (isSameDay(msgDate, yesterday)) dateLabel = t('messages.yesterday')
              else dateLabel = msgDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: msgDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
            }

          return (
            <div key={msg.id} style={{ marginBottom: isGrouped && sameAsNext ? 2 : 8 }}>
              {/* Date separator */}
              {dateLabel && (
                <div style={{
                  textAlign: 'center', margin: '8px 0 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, height: 1, background: '#F0E4EA' }} />
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#9C6B7A',
                    background: '#FDF5F8', padding: '3px 12px',
                    borderRadius: 20, border: '1px solid #F0E4EA',
                    whiteSpace: 'nowrap',
                  }}>{dateLabel}</div>
                  <div style={{ flex: 1, height: 1, background: '#F0E4EA' }} />
                </div>
              )}
            <div style={{
              display: 'flex',
              flexDirection: isOwn ? 'row-reverse' : 'row',
              alignItems: 'flex-end', gap: 8,
            }}>
              {/* Avatar — shown only on first bubble of a run; placeholder keeps alignment */}
              {!isOwn && (
                showSenderInfo ? (
                  // The photo, not just the initial: this list only ever drew a
                  // coloured letter, even for members who had set one.
                  member?.avatar_url ? (
                    <img src={member.avatar_url} alt="" style={{
                      width: 32, height: 32, borderRadius: '50%',
                      objectFit: 'cover', flexShrink: 0,
                    }} />
                  ) : (
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: member?.avatar_color || '#951345',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
                    }}>
                      {memberName(msg.user_id)?.[0]?.toUpperCase() || '?'}
                    </div>
                  )
                ) : (
                  <div style={{ width: 32, flexShrink: 0 }} />
                )
              )}

              <div style={{ maxWidth: '72%' }}>
                {/* Sender name — only on first bubble of a run */}
                {!isOwn && showSenderInfo && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3, paddingLeft: 4 }}>
                    {memberName(msg.user_id, t('messages.family'))}
                  </div>
                )}

                {/* Bubble — long press for action sheet */}
                <div
                  onMouseDown={e => startLongPress(msg, e)}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                  onTouchStart={e => startLongPress(msg, e)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onClick={() => { if (didLongPress.current) { didLongPress.current = false; return } }}
                  style={{
                    background: isOwn ? 'linear-gradient(135deg, #951345 0%, #B01650 100%)' : '#fff',
                    color: isOwn ? '#fff' : '#0D0C1D',
                    padding: '10px 14px',
                    borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    fontSize: 14,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                    cursor: 'default', userSelect: 'none',
                  }}
                >
                  {/* Reply quote */}
                  {msg.reply_to_id && (
                    <ReplyQuote
                      original={messages.find(x => x.id === msg.reply_to_id)}
                      senderName={memberName(messages.find(x => x.id === msg.reply_to_id)?.user_id)}
                    />
                  )}
                  {/* Attachment above the caption, which is how every chat
                      lays this out — and an attachment with no caption then
                      needs no empty text node under it. */}
                  {msg.media_path && (
                    <div style={{ marginBottom: msg.content ? 6 : 0 }}>
                      <MediaBubble msg={msg} isOwn={isOwn} />
                    </div>
                  )}
                  {msg.content}
                </div>

                <ReactionChips
                  reactions={reactions[msg.id]}
                  myUserId={user?.id}
                  onReact={(emoji) => react(msg.id, emoji)}
                  align={isOwn ? 'right' : 'left'}
                />

                {/* Timestamp + edited + ticks */}
                <div style={{
                  fontSize: 10, color: 'var(--muted)', marginTop: 3,
                  textAlign: isOwn ? 'right' : 'left',
                  paddingLeft: 4, paddingRight: 4,
                  display: 'flex', alignItems: 'center', gap: 4,
                  justifyContent: isOwn ? 'flex-end' : 'flex-start',
                }}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {msg.is_edited && <span style={{ fontStyle: 'italic', fontSize: 9 }}>edited</span>}
                  {isOwn && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', color: allRead ? '#34B7F1' : 'var(--muted)', fontWeight: 700 }}>
                      {someRead ? <DoubleTick /> : <SingleTick />}
                    </span>
                  )}
                </div>
              </div>
            </div>
            </div>
          )
        })
        })()}
        <div ref={bottomRef} />
      </div>
      </PullToRefresh>

      {/* Reply bar above input */}
      <ReplyBar replyTo={replyTo} senderName={memberName(replyTo?.user_id)} onCancel={() => setReplyTo(null)} />

      {/* The picked photo/clip, waiting for its caption and the send button */}
      <PendingMediaBar
        pending={pendingMedia}
        uploading={sending && !!pendingMedia}
        onCancel={clearPendingMedia}
      />

      {/* Input */}
      <div style={{
        padding: '12px 16px', background: '#fff',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 10, alignItems: 'flex-end',
      }}>
        <AttachButton
          onPick={setPendingMedia}
          onError={(message) => setDialog({ type: 'error', message })}
          disabled={sending}
        />
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder={pendingMedia ? t('messages.addCaption') : replyTo ? t('messages.writeReply') : t('messages.typeMessage')}
          rows={1}
          style={{
            flex: 1, padding: '12px 14px', borderRadius: 24,
            border: '1.5px solid var(--border)', fontSize: 14,
            fontFamily: 'inherit', resize: 'none', outline: 'none',
            background: 'var(--bg)', maxHeight: 100,
          }}
        />
        {/* The microphone stands down while there is something to send, so
            the row never offers two ways to act on the same draft. */}
        {!canSend && !pendingMedia && (
          <VoiceRecorder
            onRecorded={setPendingMedia}
            onError={(message) => setDialog({ type: 'error', message })}
            disabled={sending}
          />
        )}
        <button
          onClick={sendMessage}
          disabled={!canSend || sending}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: canSend ? 'linear-gradient(135deg, #951345 0%, #B01650 100%)' : '#DDB8C4',
            border: 'none', color: canSend ? '#fff' : '#951345',
            fontSize: 18, cursor: canSend ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s', flexShrink: 0,
          }}
        >➤</button>
      </div>
      </>
      )}

      {/* ── Action sheet (long press) ── */}
      {actionMsg && (
        <MessageActionSheet
          anchor={actionAnchor}
          msg={actionMsg}
          isOwn={actionMsg.user_id === user?.id}
          myReaction={(reactions[actionMsg.id] || []).find(r => r.user_id === user?.id)?.emoji}
          onReact={(emoji) => react(actionMsg.id, emoji)}
          onReply={() => { setReplyTo(actionMsg); setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }}
          onEdit={() => { setEditMsg(actionMsg); setActionMsg(null) }}
          onDelete={() => handleDelete(actionMsg)}
          onHide={() => hideMessage(actionMsg.id)}
          onInfo={() => setDetailMsg(actionMsg)}
          onClose={() => setActionMsg(null)}
        />
      )}

      {/* ── In-app dialog (replaces alert/confirm) ── */}
      {dialog && (
        <Dialog
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onClose={() => setDialog(null)}
        />
      )}

      {/* ── Edit modal ── */}
      {editMsg && (
        <EditModal msg={editMsg} onClose={() => setEditMsg(null)} onSave={handleEdit} />
      )}

      {/* ── Read-info popup ── */}
      {detailMsg && (
        <div className="overlay" onClick={() => setDetailMsg(null)}>
          <div className="popup" onClick={e => e.stopPropagation()}>
            <div className="popup-handle" />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 4 }}>
              {t('messages.messageInfo')}
            </div>
            <div style={{ background: '#F5F4FB', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: '#0D0C1D', marginBottom: 16 }}>
              {detailMsg.content}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#34B7F1', letterSpacing: 0.2, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#34B7F1', display: 'inline-flex' }}><DoubleTick /></span>
              {t('messages.readBy', { n: (reads[detailMsg.id] || []).length })}
            </div>
            {(reads[detailMsg.id] || []).length === 0 ? (
              <div style={{ fontSize: 13, color: '#8480B0', marginBottom: 14 }}>{t('messages.noneRead')}</div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                {(reads[detailMsg.id] || []).map(r => {
                  const m = members[r.user_id]
                  return (
                    <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m?.avatar_color || '#4F8EF7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                        {memberName(r.user_id, t('messages.member'))?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{memberName(r.user_id, t('messages.member'))}</div>
                        <div style={{ fontSize: 11, color: '#8480B0' }}>{new Date(r.read_at).toLocaleString()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {(() => {
              const readers = new Set((reads[detailMsg.id] || []).map(r => r.user_id))
              const pending = Object.values(members).filter(m => m.user_id !== user.id && !readers.has(m.user_id))
              if (pending.length === 0) return null
              return (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8480B0', letterSpacing: 0.2, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-flex' }}><SingleTick /></span>
                    {t('messages.deliveredNotRead', { n: pending.length })}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    {pending.map(m => (
                      <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: 0.7 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m.avatar_color || '#951345', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                          {memberName(m.user_id, t('messages.member'))?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{memberName(m.user_id, t('messages.member'))}</div>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
