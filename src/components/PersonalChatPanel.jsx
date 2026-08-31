import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../i18n'
import { useAuthStore } from '../store/authStore'
import { useHiddenMessages } from '../hooks/useHiddenMessages'
import PullToRefresh from '../components/PullToRefresh'
import { useBackButton } from '../hooks/useBackButton'
import {
  SingleTick, DoubleTick, ReplyBar, ReplyQuote, MessageActionSheet, EditModal,
} from './MessageActions'

/**
 * PersonalChatPanel
 *
 * One-to-one chat between two family members, shown as the "Personal" tab
 * beside the family-wide Chat.
 *
 * Two views in one panel: a list of family members with their latest private
 * message, and the open thread. Kept as one component because the thread has
 * to push its new messages back into the list previews, and splitting it would
 * mean lifting all that state one level anyway.
 *
 * Per-message actions (reply / edit / delete / info) come from
 * ../components/MessageActions, the same components the family room uses, so
 * the two chats behave identically. What differs is the message info popup:
 * a private thread has one possible reader, so read state is a single read_at
 * on the row rather than the family room's list of readers.
 *
 * Privacy is enforced in the database, not here: RLS on direct_messages
 * restricts SELECT to the two participants, so the realtime subscription
 * below physically cannot deliver somebody else's private thread.
 */

const DM_COLUMNS = 'id, sender_id, recipient_id, content, created_at, reply_to_id, is_edited, edited_at, read_at'

function timeShort(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor((now - d) / 86400000)
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function Avatar({ member, size = 44 }) {
  if (member.avatar_url) {
    return (
      <img src={member.avatar_url} alt={member.display_name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #951345' }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: member.avatar_color && member.avatar_color !== '#4F8EF7' ? member.avatar_color : '#951345',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.36,
      border: '2px solid #951345', boxSizing: 'border-box',
    }}>
      {member.display_name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

export default function PersonalChatPanel({ onDialog, resetSignal, onControls }) {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const { hidden: hiddenMsgs, hide: hideMessage } = useHiddenMessages('direct', user?.id)
  // Held in a ref rather than state: the pull-to-refresh handler needs to call
  // the loader, but making it a dependency would re-run the effect and tear down
  // the realtime channel on every render.
  const reloadRef = useRef(null)
  const reload = useCallback(async () => { await reloadRef.current?.() }, [])
  const [members, setMembers]   = useState([])
  const [messages, setMessages] = useState([])   // every DM I am part of
  const [openWith, setOpenWith] = useState(null) // member object, or null for the list
  const [draft, setDraft]       = useState('')
  const [sending, setSending]   = useState(false)
  const [clearing, setClearing] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [actionAnchor, setActionAnchor] = useState(null)
  const [actionMsg, setActionMsg] = useState(null) // long-press action sheet
  const [editMsg, setEditMsg]     = useState(null) // edit modal
  const [replyTo, setReplyTo]     = useState(null) // message being replied to
  const [detailMsg, setDetailMsg] = useState(null) // message info popup
  const endRef = useRef(null)
  const longPressRef = useRef(null)
  const didLongPress = useRef(false)

  // Leaving a thread, without a back arrow in the header:
  //   - hardware back on Android
  //   - tapping the Personal tab again (resetSignal), which also covers web
  useBackButton(!!openWith, () => setOpenWith(null))
  useEffect(() => {
    if (resetSignal) setOpenWith(null)
  }, [resetSignal])

  // ── Load members + my whole private history in this family ────────────────
  useEffect(() => {
    if (!familyId || !user) return
    let cancelled = false

    reloadRef.current = async () => {
      const [memRes, dmRes] = await Promise.all([
        supabase.from('family_members')
          .select('user_id, display_name, avatar_url, avatar_color')
          .eq('family_id', familyId),
        // RLS already limits this to threads I am part of, so no participant
        // filter is needed (or trustworthy) on the client.
        supabase.from('direct_messages')
          .select(DM_COLUMNS)
          .eq('family_id', familyId)
          .order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      setMembers((memRes.data || []).filter(m => m.user_id !== user.id))
      setMessages(dmRes.data || [])
      setLoading(false)
    }
    reloadRef.current()

    const channel = supabase
      .channel(`direct-messages:${familyId}:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        const m = payload.new
        if (!m) return
        // Belt and braces — RLS should never deliver anything else.
        if (m.sender_id !== user.id && m.recipient_id !== user.id) return
        setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'direct_messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        // Edits and read receipts both arrive here.
        const m = payload.new
        if (!m) return
        if (m.sender_id !== user.id && m.recipient_id !== user.id) return
        setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, ...m } : x)))
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'direct_messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (payload.old?.id) setMessages(prev => prev.filter(x => x.id !== payload.old.id))
      })
      // The member list was fetched once per family and never revisited, so
      // anyone who joined while this panel was mounted was missing from it —
      // there was no way to start a chat with a new member short of
      // restarting the app. INSERT/DELETE only: member UPDATEs are mostly
      // heartbeats, and reloading the whole history on each one would be
      // constant pointless traffic.
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'family_members',
        filter: `family_id=eq.${familyId}`,
      }, () => { reloadRef.current?.() })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'family_members',
        filter: `family_id=eq.${familyId}`,
      }, () => { reloadRef.current?.() })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [familyId, user?.id])

  const threadFor = useCallback(
    (uid) => messages.filter(m =>
      (m.sender_id === user?.id && m.recipient_id === uid) ||
      (m.sender_id === uid && m.recipient_id === user?.id)
    ),
    [messages, user?.id]
  )

  const thread = (openWith ? threadFor(openWith.user_id) : []).filter(m => !hiddenMsgs.has(m.id))

  useEffect(() => {
    if (openWith) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length, openWith])

  // ── Read receipts ─────────────────────────────────────────────────────────
  // Marking runs whenever an unread message from the other person is on screen.
  // The RPC only ever stamps rows where I am the recipient, and the local
  // update drops the unread count to zero, so this settles after one call.
  const unreadFromOther = openWith
    ? thread.filter(m => m.sender_id === openWith.user_id && !m.read_at).length
    : 0

  useEffect(() => {
    if (!openWith || unreadFromOther === 0) return
    const other = openWith.user_id
    let cancelled = false
    ;(async () => {
      const { error } = await supabase.rpc('mark_direct_thread_read', {
        p_family_id:     familyId,
        p_other_user_id: other,
      })
      if (error || cancelled) return
      const now = new Date().toISOString()
      setMessages(prev => prev.map(m =>
        (m.sender_id === other && m.recipient_id === user?.id && !m.read_at)
          ? { ...m, read_at: now }
          : m
      ))
    })()
    return () => { cancelled = true }
  }, [openWith?.user_id, unreadFromOther, familyId, user?.id])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || !openWith || sending) return
    setSending(true)
    const { error } = await supabase.rpc('send_direct_message', {
      p_family_id:    familyId,
      p_recipient_id: openWith.user_id,
      p_content:      text,
      p_reply_to_id:  replyTo?.id || null,
    })
    setSending(false)
    if (error) {
      onDialog?.({ type: 'error', message: error.message })
      return
    }
    setDraft('')
    setReplyTo(null)
    // The realtime INSERT delivers the message back to us, so nothing is
    // appended optimistically here — that would duplicate it.
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  const handleEdit = async (msgId, newContent) => {
    const { error } = await supabase.rpc('edit_direct_message', {
      p_message_id:  msgId,
      p_new_content: newContent,
    })
    if (error) { onDialog?.({ type: 'error', message: t('messages.editFailed') }); return }
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, content: newContent, is_edited: true, edited_at: new Date().toISOString() } : m
    ))
  }

  // ── Delete one message ────────────────────────────────────────────────────
  // Removes the row, so it goes for both people — the same "for everyone"
  // semantics as deleting in the family room.
  const handleDeleteMessage = (msg) => {
    onDialog?.({
      type: 'confirm',
      title: t('messages.deleteTitle'),
      message: t('personal.deleteMsg', { name: openWith?.display_name || t('personal.theOtherPerson') }),
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        const { error } = await supabase.rpc('delete_direct_message', { p_message_id: msg.id })
        if (error) { onDialog?.({ type: 'error', message: t('messages.deleteFailed') }); return }
        setMessages(prev => prev.filter(m => m.id !== msg.id))
        setReplyTo(prev => (prev?.id === msg.id ? null : prev))
      },
    })
  }

  // Same semantics as the family chat's Clear Chat: removes the conversation
  // for BOTH people, not just from your own view.
  const handleClearThread = () => {
    if (!openWith) return
    onDialog?.({
      type: 'confirm',
      title: t('personal.clearTitle'),
      message: t('personal.clearMsg', { name: openWith.display_name }),
      confirmLabel: t('messages.clearChat'),
      onConfirm: async () => {
        setClearing(true)
        const other = openWith.user_id
        const { error } = await supabase.rpc('clear_direct_thread', {
          p_family_id:     familyId,
          p_other_user_id: other,
        })
        setClearing(false)
        if (error) { onDialog?.({ type: 'error', message: error.message }); return }
        // DELETE events are not always delivered for bulk removals, so drop
        // the thread locally rather than waiting on realtime to catch up.
        setMessages(prev => prev.filter(m =>
          !((m.sender_id === user?.id && m.recipient_id === other) ||
            (m.sender_id === other && m.recipient_id === user?.id))
        ))
        setReplyTo(null)
      },
    })
  }

  // ── Long press ────────────────────────────────────────────────────────────
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

  // Reported up so the maroon header can own this button, matching the family
  // room and the calls tab. Cleared when no thread is open so the header does
  // not offer to clear a conversation that is not on screen.
  useEffect(() => {
    onControls?.({
      canClear: !!openWith && thread.length > 0,
      clearing,
      clearThread: handleClearThread,
    })
  }, [openWith, thread.length, clearing, onControls])

  const senderNameOf = (msg) =>
    (msg?.sender_id === user?.id ? t('common.you') : openWith?.display_name)

  // ── Thread view ───────────────────────────────────────────────────────────
  if (openWith) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Thread header — no back arrow; see the navigation note above. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderBottom: '1px solid #F0E4EA', background: '#fff',
          flexShrink: 0,
        }}>
          <Avatar member={openWith} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0D0C1D' }}>{openWith.display_name}</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', minHeight: 0 }}>
          {thread.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9C6B7A' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#3A1020', marginBottom: 6 }}>
                No messages yet
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Anything you send here is private between you and {openWith.display_name}.
                The rest of the family cannot see it.
              </div>
            </div>
          ) : thread.map(m => {
            const mine = m.sender_id === user?.id
            const original = m.reply_to_id ? thread.find(x => x.id === m.reply_to_id) : null
            return (
              <div key={m.id} style={{
                display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8,
              }}>
                <div style={{ maxWidth: '78%' }}>
                  {/* Bubble — long press for the action sheet */}
                  <div
                    onMouseDown={e => startLongPress(m, e)}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={e => startLongPress(m, e)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    onClick={() => { if (didLongPress.current) { didLongPress.current = false } }}
                    style={{
                      padding: '9px 13px',
                      borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: mine ? '#951345' : '#fff',
                      color: mine ? '#fff' : '#0D0C1D',
                      border: mine ? 'none' : '1px solid #F0E4EA',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      cursor: 'default', userSelect: 'none',
                    }}
                  >
                    {m.reply_to_id && (
                      <ReplyQuote original={original} senderName={senderNameOf(original)} />
                    )}
                    <div style={{ fontSize: 13.5, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {m.content}
                    </div>
                  </div>

                  {/* Timestamp + edited + ticks */}
                  <div style={{
                    fontSize: 9.5, marginTop: 3, color: '#B69AA6',
                    display: 'flex', alignItems: 'center', gap: 4,
                    justifyContent: mine ? 'flex-end' : 'flex-start',
                    paddingLeft: 4, paddingRight: 4,
                  }}>
                    {timeShort(m.created_at)}
                    {m.is_edited && <span style={{ fontStyle: 'italic', fontSize: 9 }}>edited</span>}
                    {mine && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', fontWeight: 700,
                        color: m.read_at ? '#34B7F1' : '#B69AA6',
                      }}>
                        {m.read_at ? <DoubleTick /> : <SingleTick />}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        {/* Reply bar above the composer */}
        <ReplyBar
          replyTo={replyTo}
          senderName={senderNameOf(replyTo)}
          onCancel={() => setReplyTo(null)}
        />

        {/* Composer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderTop: '1px solid #F0E4EA',
          background: '#fff', flexShrink: 0,
        }}>
          <input
            className="input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
            placeholder={replyTo ? t('messages.writeReply') : t('personal.messagePlaceholder', { name: openWith.display_name })}
            style={{ flex: 1, borderRadius: 22, padding: '11px 16px', fontSize: 14 }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            aria-label="Send"
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0, border: 'none',
              background: draft.trim() ? '#951345' : '#E4D6DD',
              color: '#fff', cursor: draft.trim() ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.5 21 23 12 2.5 3 2.5 10l14 2-14 2z" />
            </svg>
          </button>
        </div>

        {/* ── Action sheet (long press) ── */}
        {actionMsg && (
          <MessageActionSheet
            anchor={actionAnchor}
            msg={actionMsg}
            isOwn={actionMsg.sender_id === user?.id}
            onReply={() => { setReplyTo(actionMsg); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }}
            onEdit={() => { setEditMsg(actionMsg); setActionMsg(null) }}
            onDelete={() => handleDeleteMessage(actionMsg)}
            onHide={() => hideMessage(actionMsg.id)}
            onInfo={() => setDetailMsg(actionMsg)}
            onClose={() => setActionMsg(null)}
          />
        )}

        {/* ── Edit modal ── */}
        {editMsg && (
          <EditModal
            msg={editMsg}
            subtitle={`Changes are visible to ${openWith.display_name}`}
            onClose={() => setEditMsg(null)}
            onSave={handleEdit}
          />
        )}

        {/* ── Message info popup ── */}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                <span style={{ color: '#8480B0', display: 'inline-flex' }}><SingleTick /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>Sent</div>
                  <div style={{ fontSize: 11, color: '#8480B0' }}>{new Date(detailMsg.created_at).toLocaleString()}</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: detailMsg.read_at ? 1 : 0.7 }}>
                <span style={{ color: detailMsg.read_at ? '#34B7F1' : '#8480B0', display: 'inline-flex' }}><DoubleTick /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>
                    {detailMsg.read_at ? t('personal.readBy', { name: openWith.display_name }) : t('personal.notReadYet')}
                  </div>
                  <div style={{ fontSize: 11, color: '#8480B0' }}>
                    {detailMsg.read_at
                      ? new Date(detailMsg.read_at).toLocaleString()
                      : `${openWith.display_name} has not opened this chat since you sent it.`}
                  </div>
                </div>
              </div>

              {detailMsg.is_edited && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                  <span style={{ color: '#059669', display: 'inline-flex' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>Edited</div>
                    <div style={{ fontSize: 11, color: '#8480B0' }}>
                      {detailMsg.edited_at ? new Date(detailMsg.edited_at).toLocaleString() : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Conversation list ─────────────────────────────────────────────────────
  return (
    <PullToRefresh onRefresh={reload}>
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px 12px 20px' }}>
      {loading ? null : members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9C6B7A', fontSize: 13 }}>
          Nobody else has joined this family yet.
        </div>
      ) : members.map(m => {
        // Deliberately NOT named `t`: that shadowed the translation function
        // from useT() in this scope, so the two t(...) calls below were
        // invoking this array and threw "t is not a function". It only
        // surfaced once the family had a second real member — until then the
        // empty-list branch above ran instead and the map never executed.
        const memberThread = threadFor(m.user_id)
        const last = memberThread[memberThread.length - 1]
        return (
          <button
            key={m.user_id}
            onClick={() => setOpenWith(m)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 8px', background: 'none', border: 'none',
              borderBottom: '1px solid #F8F0F4', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <Avatar member={m} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{m.display_name}</div>
              <div style={{
                fontSize: 12, color: last ? '#5B4652' : '#B69AA6',
                marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontStyle: last ? 'normal' : 'italic',
              }}>
                {last
                  ? `${last.sender_id === user?.id ? t('personal.youPrefix') : ''}${last.content}`
                  : t('personal.startChat')}
              </div>
            </div>
            {last && (
              <div style={{ fontSize: 10.5, color: '#B69AA6', flexShrink: 0 }}>
                {timeShort(last.created_at)}
              </div>
            )}
          </button>
        )
      })}
    </div>
    </PullToRefresh>
  )
}
