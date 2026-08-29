import { useState } from 'react'

/**
 * MessageActions
 *
 * The per-message UI shared by the family room (MessagesPage) and the private
 * one-to-one threads (PersonalChatPanel): read ticks, the reply strip above
 * the composer, the quoted-reply block inside a bubble, the long-press action
 * sheet and the edit modal.
 *
 * Lifted out of MessagesPage rather than copied into the personal chat so the
 * two stay identical by construction — the family room is where these were
 * designed, and a second copy would drift the first time either is touched.
 *
 * The two chats store a sender differently (`user_id` vs `sender_id`) and look
 * names up from different maps, so anything sender-shaped is passed in already
 * resolved as `senderName` instead of being looked up here.
 */

export function SingleTick() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
      <path d="M2 6.5 L5.5 10 L11 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DoubleTick() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
      <path d="M1 6.5 L4.5 10 L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6.5 L9.5 10 L15 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Reply preview strip shown above the input ─────────────────────────────────
export function ReplyBar({ replyTo, senderName, onCancel }) {
  if (!replyTo) return null
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
          Replying to {senderName || 'Family'}
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
// `original` is the message being quoted, already resolved by the caller; it is
// null when that message has since been deleted, and the quote then disappears.
export function ReplyQuote({ original, senderName }) {
  if (!original) return null
  return (
    <div style={{
      borderLeft: '3px solid rgba(255,255,255,0.45)',
      paddingLeft: 8, marginBottom: 6,
      opacity: 0.85,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>
        {senderName || 'Family'}
      </div>
      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {original.content}
      </div>
    </div>
  )
}

// ── Action sheet — long press on any message ──────────────────────────────────
// Rows are plain and colour lives only in the icon tile, matching the member
// sheet on the Family page. The labels carried a caption each ("Reply to this
// message", "Remove for everyone") that only restated the label, and four
// full-width coloured blocks made every action shout equally loudly.
function ActionRow({ icon, label, color, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '9px 4px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 11,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: `${color}14`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: danger ? color : '#0D0C1D' }}>
        {label}
      </div>
      <span style={{ color: '#D8C3CD', fontSize: 16, flexShrink: 0 }}>›</span>
    </button>
  )
}

export function MessageActionSheet({ msg, isOwn, onReply, onEdit, onDelete, onInfo, onClose }) {
  const actions = [
    {
      label: 'Reply', color: '#951345', fn: onReply, show: true,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      ),
    },
    {
      label: 'Edit', color: '#951345', fn: onEdit, show: isOwn,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      ),
    },
    {
      label: 'Message Info', color: '#951345', fn: onInfo, show: isOwn,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
    },
  ].filter(a => a.show)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '6px 18px 18px' }}>
        {/* The shared .popup-handle reserves 38px of margin, sized for sheets
            that open with a member header. This one is a short action list, so
            it uses a tighter handle of its own. */}
        <div style={{ width: 44, height: 4, background: '#E4D6DD', borderRadius: 2, margin: '9px auto 12px' }} />

        {/* Which message this is about — the sheet is opened by a long press,
            so without it there is nothing on screen tying the actions to one
            bubble. */}
        <div style={{ marginBottom: 4, paddingBottom: 10, borderBottom: '1px solid #F0E4EA' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 2 }}>
            {isOwn ? 'Your message' : 'Message'}
          </div>
          <div style={{ fontSize: 13.5, color: '#0D0C1D', lineHeight: 1.45, maxHeight: 58, overflow: 'hidden' }}>
            {msg.content}
          </div>
        </div>

        {actions.map((a, i) => (
          <div key={a.label}>
            {i > 0 && <div style={{ height: 1, background: '#F7EFF3' }} />}
            <ActionRow icon={a.icon} label={a.label} color={a.color} onClick={() => { a.fn(); onClose() }} />
          </div>
        ))}

        {/* Destructive action, separated and quieter than the everyday ones —
            it removes the message for everyone and cannot be undone. */}
        {isOwn && (
          <>
            <div style={{ height: 1, background: '#F0E4EA', margin: '5px 0' }} />
            <ActionRow
              danger color="#E11D48" label="Delete"
              icon={(
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              )}
              onClick={() => { onDelete(); onClose() }}
            />
          </>
        )}

        <button onClick={onClose} style={{
          width: '100%', padding: '11px 18px', borderRadius: 12, marginTop: 10,
          background: '#F7F4F8', border: '1px solid #EEE6EC',
          color: '#5B4652', fontWeight: 700, fontSize: 13.5,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
export function EditModal({ msg, onClose, onSave, subtitle }) {
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
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
              {subtitle || 'Changes are visible to all family members'}
            </div>
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
