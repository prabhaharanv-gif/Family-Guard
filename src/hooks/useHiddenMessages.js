import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Messages this person has hidden from their own view ("Delete for me").
 *
 * Filtering happens client-side rather than in the fetch queries: the family
 * room and the private threads read from different tables through different
 * paths, and one shared id set is far less invasive than reworking each query
 * to join against hidden_messages.
 *
 * Deleting someone else's message outright is refused server-side — both delete
 * RPCs check auth.uid() against the sender — so hiding is the only thing a
 * reader can do to a message they did not write.
 *
 * `kind` is 'family' or 'direct', matching the column of the same name.
 */
export function useHiddenMessages(kind, userId) {
  const [hidden, setHidden] = useState(() => new Set())
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('hidden_messages')
      .select('message_id')
      .eq('kind', kind)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        setHidden(new Set(data.map(r => r.message_id)))
      })
    return () => { cancelled = true }
  }, [kind, userId])

  /**
   * Hide one message. The id is added locally first so the message disappears
   * on tap rather than after a round-trip, and removed again if the write
   * fails — leaving it hidden after a failed save would be a lie that survives
   * until the next reload.
   */
  const hide = useCallback(async (messageId) => {
    if (!messageId) return { error: null }
    setHidden(prev => new Set(prev).add(messageId))
    const { error } = await supabase.rpc('hide_message', {
      p_message_id: messageId,
      p_kind: kind,
    })
    if (error) {
      setHidden(prev => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
    return { error }
  }, [kind])

  /**
   * Hide a batch at once — the family room's Clear Chat, which hides the whole
   * backlog for me and leaves it untouched for everyone else. The ids come
   * back from the RPC that wrote them, so this only mirrors what the database
   * already recorded and never needs rolling back.
   */
  const hideMany = useCallback((messageIds) => {
    if (!messageIds || messageIds.length === 0) return
    setHidden(prev => {
      const next = new Set(prev)
      messageIds.forEach(id => next.add(id))
      return next
    })
  }, [])

  return { hidden, hide, hideMany }
}
