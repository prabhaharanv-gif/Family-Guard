import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Emoji reactions for one chat.
 *
 * `kind` is 'family' or 'direct', matching the column of the same name; the
 * family room and the private threads are separate tables, so a reaction row
 * has to say which message it belongs to.
 *
 * One reaction per person per message: reacting again replaces your emoji and
 * tapping the one you already chose clears it. The RPC enforces that with a
 * primary key, so nothing here has to guard against duplicates.
 *
 * Shape: { [messageId]: [{ user_id, emoji }] } — the order rows arrive in,
 * which is the order they were added.
 */
export function useReactions(kind, familyId, userId) {
  const [reactions, setReactions] = useState({})

  useEffect(() => {
    if (!familyId || !userId) { setReactions({}); return }
    let cancelled = false

    const apply = (rows) => {
      const map = {}
      rows.forEach((r) => {
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push({ user_id: r.user_id, emoji: r.emoji })
      })
      setReactions(map)
    }

    supabase
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .eq('family_id', familyId)
      .eq('kind', kind)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        apply(data)
      })

    // One row at a time rather than a re-fetch: reactions arrive in bursts when
    // several people pile onto the same message, and each would otherwise pull
    // the whole table for the family.
    const upsertLocal = (row) => {
      if (!row || row.kind !== kind) return
      setReactions((prev) => {
        const list = (prev[row.message_id] || []).filter((r) => r.user_id !== row.user_id)
        return { ...prev, [row.message_id]: [...list, { user_id: row.user_id, emoji: row.emoji }] }
      })
    }
    const removeLocal = (row) => {
      if (!row || row.kind !== kind) return
      setReactions((prev) => {
        const list = (prev[row.message_id] || []).filter((r) => r.user_id !== row.user_id)
        const next = { ...prev }
        if (list.length) next[row.message_id] = list
        else delete next[row.message_id]
        return next
      })
    }

    const channel = supabase
      .channel(`reactions:${kind}:${familyId}:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'message_reactions',
        filter: `family_id=eq.${familyId}`,
      }, ({ new: row }) => upsertLocal(row))
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'message_reactions',
        filter: `family_id=eq.${familyId}`,
      }, ({ new: row }) => upsertLocal(row))
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'message_reactions',
        filter: `family_id=eq.${familyId}`,
      }, ({ old: row }) => removeLocal(row))
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [kind, familyId, userId])

  /**
   * Set, change or clear my reaction. Tapping the emoji I already have clears
   * it, which is the toggle every chat app uses.
   *
   * Applied locally first so the chip appears on tap rather than after a round
   * trip, and rolled back if the write fails.
   */
  const react = useCallback(async (messageId, emoji) => {
    if (!messageId || !userId) return
    const before = reactions[messageId] || []
    const mine   = before.find((r) => r.user_id === userId)
    const next   = mine && mine.emoji === emoji ? '' : emoji

    setReactions((prev) => {
      const list = (prev[messageId] || []).filter((r) => r.user_id !== userId)
      if (next) return { ...prev, [messageId]: [...list, { user_id: userId, emoji: next }] }
      const out = { ...prev }
      if (list.length) out[messageId] = list
      else delete out[messageId]
      return out
    })

    const { error } = await supabase.rpc('set_message_reaction', {
      p_message_id: messageId,
      p_kind:       kind,
      p_emoji:      next || null,
    })
    if (error) {
      setReactions((prev) => {
        const out = { ...prev }
        if (before.length) out[messageId] = before
        else delete out[messageId]
        return out
      })
    }
  }, [kind, userId, reactions])

  return { reactions, react }
}
