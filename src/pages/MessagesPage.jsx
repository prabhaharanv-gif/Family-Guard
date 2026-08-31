import { useState, useEffect, useRef } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'
import { readMuteLevel, writeMuteLevel, MUTE_LEVELS } from '../lib/muteLevel'

const MessagesPageNative = registerPlugin('MessagesPage')
function notifyNativePageOpen(open) {
  if (!Capacitor.isNativePlatform()) return
  try { MessagesPageNative.setOpen({ open }) } catch (e) {}
}
function setNativeMuteLevel(level) {
  if (!Capacitor.isNativePlatform()) return
  try { MessagesPageNative.setMuteLevel({ level }) } catch (e) {}
}

function SingleTick() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
      <path d="M2 6.5 L5.5 10 L11 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DoubleTick() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
      <path d="M1 6.5 L4.5 10 L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6.5 L9.5 10 L15 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Reply preview strip shown above the input ─────────────────────────────────
function ReplyBar({ replyTo, members, onCancel }) {
  if (!replyTo) return null
  const sender = members[replyTo.user_id]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px',
      background: '#F0EEFF',
      borderTop: '1px solid #D6D0FF',
      borderLeft: '3px solid #7C3AED',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#7C3AED', marginBottom: 2 }}>
          Replying to {sender?.display_name || 'Family'}
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {replyTo.content}
        </div>
      </div>
      <button onClick={onCancel} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 18, color: '#8480B0', padding: '0 4px', flexShrink: 0,
      }}>✕</button>
    </div>
  )
}

// ── Quoted reply block shown inside a message bubble ─────────────────────────
function ReplyQuote({ replyToId, messages, members }) {
  const original = messages.find(m => m.id === replyToId)
  if (!original) return null
  const sender = members[original.user_id]
  return (
    <div style={{
      borderLeft: '3px solid rgba(255,255,255,0.45)',
      paddingLeft: 8, marginBottom: 6,
      opacity: 0.85,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>
        {sender?.display_name || 'Family'}
      </div>
      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {original.content}
      </div>
    </div>
  )
}

// ── Action sheet — long press on any message ──────────────────────────────────
function MessageActionSheet({ msg, isOwn, onReply, onEdit, onDelete, onInfo, onClose }) {
  const actions = [
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      ),
      label: 'Reply', sub: 'Reply to this message',
      color: '#4F46E5', bg: '#EEF2FF', fn: onReply, show: true,
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      ),
      label: 'Edit', sub: 'Edit this message',
      color: '#059669', bg: '#F0FDF4', fn: onEdit, show: isOwn,
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      ),
      label: 'Delete', sub: 'Remove for everyone',
      color: '#DC2626', bg: '#FEF2F2', fn: onDelete, show: isOwn,
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
      label: 'Message Info', sub: 'See who has read this',
      color: '#6B7280', bg: '#F9FAFB', fn: onInfo, show: isOwn,
    },
  ].filter(a => a.show)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '20px 16px 28px' }}>
        <div className="popup-handle" />

        {/* Message preview */}
        <div style={{
          background: 'linear-gradient(135deg, #FDF7FA 0%, #F8F0F5 100%)',
          borderRadius: 16, padding: '14px 16px',
          marginBottom: 20,
          border: '1.5px solid #EEE0E6',
          boxShadow: '0 2px 8px rgba(149,19,69,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: isOwn ? '#951345' : '#6B7280',
            }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: isOwn ? '#951345' : '#6B7280', letterSpacing: 0.2 }}>
              {isOwn ? 'Your message' : 'Message'}
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#0D0C1D', lineHeight: 1.5, maxHeight: 72, overflow: 'hidden' }}>
            {msg.content}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {actions.map((a, i) => (
            <button key={a.label} onClick={() => { a.fn(); onClose() }} style={{
              width: '100%', padding: '13px 16px', borderRadius: 14,
              background: a.bg, border: `1px solid ${a.color}20`,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.15s',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: a.color + '15', border: `1.5px solid ${a.color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {a.icon}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: a.color }}>{a.label}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>{a.sub}</div>
              </div>
              <svg style={{ marginLeft: 'auto', opacity: 0.3 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: '#F0EAF5', margin: '4px 0' }} />

          <button onClick={onClose} style={{
            width: '100%', padding: '13px 16px', borderRadius: 14,
            background: '#F8F7FF', border: '1px solid #EDE9FF',
            color: '#6B7280', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({ msg, onClose, onSave }) {
  const [text, setText] = useState(msg.content)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!text.trim() || text.trim() === msg.content) { onClose(); return }
    setSaving(true)
    await onSave(msg.id, text.trim())
    setSaving(false)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '20px 16px 28px' }}>
        <div className="popup-handle" />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#F0FDF4', border: '1.5px solid #BBF7D0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0C1D' }}>Edit Message</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>Changes are visible to all family members</div>
          </div>
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          autoFocus
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            border: '1.5px solid #E5E7EB', fontSize: 14,
            fontFamily: 'inherit', resize: 'none', outline: 'none',
            minHeight: 90, boxSizing: 'border-box', marginBottom: 16,
            background: '#FAFAFA', lineHeight: 1.5,
            transition: 'border-color 0.2s',
          }}
          onFocus={e => e.target.style.borderColor = '#059669'}
          onBlur={e => e.target.style.borderColor = '#E5E7EB'}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#F8F7FF', border: '1px solid #EDE9FF',
            color: '#6B7280', fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !text.trim()} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: text.trim() ? 'linear-gradient(135deg, #951345, #720D35)' : '#F5E8EE',
            border: 'none', color: '#fff', fontWeight: 700,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: 14,
            boxShadow: text.trim() ? '0 4px 14px rgba(5,150,105,0.35)' : 'none',
            transition: 'all 0.2s',
          }}>
            {saving ? 'Saving...' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MessagesPage() {
  const { user, familyId } = useAuthStore()
  const [messages, setMessages]   = useState([])
  const [members, setMembers]     = useState({})
  const [msgsLoaded, setMsgsLoaded] = useState(false)
  const [reads, setReads]         = useState({})
  const [detailMsg, setDetailMsg] = useState(null)   // read-info popup
  const [actionMsg, setActionMsg] = useState(null)   // long-press action sheet
  const [editMsg, setEditMsg]     = useState(null)   // edit modal
  const [replyTo, setReplyTo]     = useState(null)   // message being replied to
  const [text, setText]           = useState('')
  const [sending, setSending]     = useState(false)
  const [clearing, setClearing]   = useState(false)
  const [muteLevel, setMuteLevel] = useState(readMuteLevel)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch]   = useState(false)
  const [dialog, setDialog]           = useState(null) // { type, title, message, onConfirm }
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
      supabase.from('family_members').select('user_id, display_name, avatar_color').eq('family_id', familyId),
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
    supabase.from('family_members').select('user_id, display_name, avatar_color')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) { const map = {}; data.forEach(m => { map[m.user_id] = m }); setMembers(map) }
      })
  }, [familyId])

  useEffect(() => {
    if (!familyId) return
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
          if (payload.new.user_id !== user?.id) markReadIfVisible()
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

    return () => { document.removeEventListener('visibilitychange', onVisible); supabase.removeChannel(channel) }
  }, [familyId])

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!text.trim() || sending) return
    if (!user?.id || !familyId) {
      setDialog({ type: 'error', message: 'You are not in a family yet. Join or create one to send messages.' })
      return
    }
    setSending(true)
    try {
      const { error } = await supabase.from('messages').insert({
        family_id:   familyId,
        user_id:     user.id,
        content:     text.trim(),
        reply_to_id: replyTo?.id || null,
      })
      if (error) {
        // Keep what they typed so a failed send isn't a lost message
        setDialog({ type: 'error', message: `Could not send message. ${error.message}` })
        return
      }
      setText('')
      setReplyTo(null)
    } catch (e) {
      setDialog({ type: 'error', message: `Could not send message. ${e?.message || e}` })
    } finally {
      setSending(false)
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────
  const handleEdit = async (msgId, newContent) => {
    const { error } = await supabase.rpc('edit_message', {
      p_message_id:  msgId,
      p_new_content: newContent,
    })
    if (error) setDialog({ type: 'error', message: 'Could not edit message. Please try again.' })
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = (msg) => {
    setDialog({
      type: 'confirm',
      title: 'Delete Message',
      message: 'This will delete the message for everyone in the family.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const { error } = await supabase.rpc('delete_message', { p_message_id: msg.id })
        if (error) setDialog({ type: 'error', message: 'Could not delete message. Please try again.' })
        else setMessages(prev => prev.filter(m => m.id !== msg.id))
      },
    })
  }

  // ── Clear chat ──────────────────────────────────────────────────────────────
  const handleClearMessages = () => {
    setDialog({
      type: 'confirm',
      title: 'Clear All Messages',
      message: 'This will delete all messages for everyone in this family and cannot be undone.',
      confirmLabel: 'Clear Chat',
      onConfirm: async () => {
        setClearing(true)
        try {
          const { error } = await supabase.from('messages').delete().eq('family_id', familyId)
          if (error) {
            setDialog({ type: 'error', message: `Could not clear messages. ${error.message}` })
            return
          }
          setMessages([])
        } finally {
          setClearing(false)
        }
      },
    })
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
    { icon: '🔔', tip: 'Notifications on' },
    { icon: '🔕', tip: 'Sound muted' },
    { icon: '🚫', tip: 'All muted' },
  ]
  // Never index blind — an unexpected level must not take the whole page down
  const muteState = MUTE_STATES[muteLevel] || MUTE_STATES[0]

  // ── Long press ──────────────────────────────────────────────────────────────
  const startLongPress = (msg) => {
    didLongPress.current = false
    longPressRef.current = setTimeout(() => {
      didLongPress.current = true
      try { if (navigator.vibrate) navigator.vibrate(40) } catch (e) {}
      setActionMsg(msg)
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top Bar */}
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="top-bar-title">💬 Messages</div>
            <button onClick={handleMuteToggle} title={muteState.tip} style={{
              marginTop: 3, background: 'none', border: 'none',
              cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ fontSize: 15 }}>{muteState.icon}</span>
              {muteLevel > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700,
                  color: muteLevel === 1 ? '#FFD700' : '#FF8080' }}>
                  {muteLevel === 1 ? 'Sound off' : 'Muted'}
                </span>
              )}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {messages.length > 0 && (
            <button onClick={handleClearMessages} disabled={clearing} style={{
              background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
              color: '#951345', borderRadius: 10, padding: '7px 12px',
              fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {clearing ? 'Clearing...' : 'Clear Chat'}
            </button>
          )}
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
        </div>
      </div>

      {showSearch && (
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

      {Object.keys(typingUsers).length > 0 && (
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
              ? `${members[Object.keys(typingUsers)[0]]?.display_name || 'Someone'} is typing...`
              : 'Several people are typing...'}
          </span>
        </div>
      )}

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

        {msgsLoaded && messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">💬</div>
            <div className="empty-text">No messages yet</div>
            <div className="empty-sub">Send the first message to your family!</div>
          </div>
        )}

        {msgsLoaded && searchQuery && messages.filter(m => m.content?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">🔍</div>
            <div className="empty-text">No results</div>
            <div className="empty-sub">No messages match "{searchQuery}"</div>
          </div>
        )}

        {msgsLoaded && (() => {
          let lastDateLabel = null
          const filtered = searchQuery
            ? messages.filter(m => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
            : messages
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
              if (isSameDay(msgDate, today)) dateLabel = 'Today'
              else if (isSameDay(msgDate, yesterday)) dateLabel = 'Yesterday'
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
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: member?.avatar_color || '#951345',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
                  }}>
                    {member?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                ) : (
                  <div style={{ width: 32, flexShrink: 0 }} />
                )
              )}

              <div style={{ maxWidth: '72%' }}>
                {/* Sender name — only on first bubble of a run */}
                {!isOwn && showSenderInfo && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3, paddingLeft: 4 }}>
                    {member?.display_name || 'Family'}
                  </div>
                )}

                {/* Bubble — long press for action sheet */}
                <div
                  onMouseDown={() => startLongPress(msg)}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                  onTouchStart={() => startLongPress(msg)}
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
                    <ReplyQuote replyToId={msg.reply_to_id} messages={messages} members={members} />
                  )}
                  {msg.content}
                </div>

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
      <ReplyBar replyTo={replyTo} members={members} onCancel={() => setReplyTo(null)} />

      {/* Input */}
      <div style={{
        padding: '12px 16px', background: '#fff',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 10, alignItems: 'flex-end',
      }}>
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder={replyTo ? 'Write a reply...' : 'Type a message...'}
          rows={1}
          style={{
            flex: 1, padding: '12px 14px', borderRadius: 24,
            border: '1.5px solid var(--border)', fontSize: 14,
            fontFamily: 'inherit', resize: 'none', outline: 'none',
            background: 'var(--bg)', maxHeight: 100,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!text.trim() || sending}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: text.trim() ? 'linear-gradient(135deg, #951345 0%, #B01650 100%)' : '#DDB8C4',
            border: 'none', color: text.trim() ? '#fff' : '#951345',
            fontSize: 18, cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s', flexShrink: 0,
          }}
        >➤</button>
      </div>

      {/* ── Action sheet (long press) ── */}
      {actionMsg && (
        <MessageActionSheet
          msg={actionMsg}
          isOwn={actionMsg.user_id === user?.id}
          onReply={() => { setReplyTo(actionMsg); setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }}
          onEdit={() => setEditMsg(actionMsg)}
          onDelete={() => handleDelete(actionMsg)}
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
              Message Info
            </div>
            <div style={{ background: '#F5F4FB', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: '#0D0C1D', marginBottom: 16 }}>
              {detailMsg.content}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#34B7F1', letterSpacing: 0.2, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#34B7F1', display: 'inline-flex' }}><DoubleTick /></span>
              Read by {(reads[detailMsg.id] || []).length}
            </div>
            {(reads[detailMsg.id] || []).length === 0 ? (
              <div style={{ fontSize: 13, color: '#8480B0', marginBottom: 14 }}>No one has read this yet.</div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                {(reads[detailMsg.id] || []).map(r => {
                  const m = members[r.user_id]
                  return (
                    <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m?.avatar_color || '#4F8EF7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                        {m?.display_name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{m?.display_name || 'Member'}</div>
                        <div style={{ fontSize: 11, color: '#8480B0' }}>{new Date(r.read_at).toLocaleString()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {(() => {
              const readers = new Set((reads[detailMsg.id] || []).map(r => r.user_id))
              const pending = Object.values(members).filter(m => m.user_id !== user?.id && !readers.has(m.user_id))
              if (pending.length === 0) return null
              return (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8480B0', letterSpacing: 0.2, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-flex' }}><SingleTick /></span>
                    Delivered · not read ({pending.length})
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    {pending.map(m => (
                      <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: 0.7 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m.avatar_color || '#951345', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                          {m.display_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{m.display_name || 'Member'}</div>
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
