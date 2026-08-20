import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function MessagesPage() {
  const { user, familyId } = useAuthStore()
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!familyId) return
    supabase.from('family_members').select('user_id, display_name, avatar_color')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(m => { map[m.user_id] = m })
          setMembers(map)
        }
      })
  }, [familyId])

  useEffect(() => {
    if (!familyId) return

    supabase.from('messages')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setMessages(data) })

    const channel = supabase
      .channel(`messages:${familyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new])
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `family_id=eq.${familyId}`,
      }, () => {
        // Any delete event — reload messages (handles bulk clear)
        supabase.from('messages').select('*')
          .eq('family_id', familyId)
          .order('created_at', { ascending: true })
          .then(({ data }) => setMessages(data || []))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await supabase.from('messages').insert({
      family_id: familyId,
      user_id: user.id,
      content: text.trim(),
    })
    setText('')
    setSending(false)
  }

  const handleClearMessages = async () => {
    if (!window.confirm('Clear all messages for everyone in this family? This cannot be undone.')) return
    setClearing(true)
    await supabase.from('messages').delete().eq('family_id', familyId)
    setMessages([])
    setClearing(false)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Bar with Clear button */}
      <div className="top-bar">
        <div>
          <div className="top-bar-title">💬 Messages</div>
          <div className="top-bar-sub">Family group chat</div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClearMessages}
            disabled={clearing}
            style={{
              background: 'rgba(245,59,87,0.18)',
              border: '1px solid rgba(245,59,87,0.35)',
              color: '#FF6B80',
              borderRadius: 10,
              padding: '7px 12px',
              fontWeight: 700,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {clearing ? '...' : '🗑️ Clear'}
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">💬</div>
            <div className="empty-text">No messages yet</div>
            <div className="empty-sub">Send the first message to your family!</div>
          </div>
        )}

        {messages.map(msg => {
          const isOwn = msg.user_id === user?.id
          const member = members[msg.user_id]
          return (
            <div key={msg.id} style={{
              display: 'flex',
              flexDirection: isOwn ? 'row-reverse' : 'row',
              alignItems: 'flex-end',
              gap: 8,
            }}>
              {!isOwn && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: member?.avatar_color || '#4F8EF7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
                }}>
                  {member?.display_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}

              <div style={{ maxWidth: '70%' }}>
                {!isOwn && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3, paddingLeft: 4 }}>
                    {member?.display_name || 'Family'}
                  </div>
                )}
                <div style={{
                  background: isOwn ? 'var(--blue)' : '#fff',
                  color: isOwn ? '#fff' : 'var(--text)',
                  padding: '10px 14px',
                  borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  fontSize: 14,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}>
                  {msg.content}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--muted)',
                  marginTop: 3,
                  textAlign: isOwn ? 'right' : 'left',
                  paddingLeft: 4, paddingRight: 4,
                }}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        background: '#fff',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
      }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message..."
          rows={1}
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 24,
            border: '1.5px solid var(--border)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            background: 'var(--bg)',
            maxHeight: 100,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!text.trim() || sending}
          style={{
            width: 44, height: 44,
            borderRadius: '50%',
            background: text.trim() ? 'var(--blue)' : 'var(--border)',
            border: 'none',
            color: '#fff',
            fontSize: 18,
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          ➤
        </button>
      </div>
    </div>
  )
}
