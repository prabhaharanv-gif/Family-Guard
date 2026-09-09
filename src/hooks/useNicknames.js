import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

/**
 * The private name I have given each family member.
 *
 * Nicknames are set by long-pressing a member card on the Family page and are
 * private to whoever set them — member_nicknames is keyed by owner_user_id, so
 * the same person is called something different on each phone.
 *
 * They were being applied on the Family page and nowhere else, so a member
 * renamed on the family card still arrived in chat, in the personal threads,
 * in call history and on the call screen under the name they typed at
 * registration. This puts one map behind all of them.
 *
 * A store rather than per-component state: several screens need the same map
 * at once (the family room and the personal panel are mounted together), and
 * renaming somebody on the Family page has to be visible in chat without a
 * reload. member_nicknames is not in the realtime publication, so the Family
 * page pushes its own edits in through setNicknameLocally().
 */

const EMPTY = {}

const useNicknameStore = create((set) => ({
  // `${familyId}:${userId}` the map belongs to — switching family must not
  // leave the previous family's nicknames on screen.
  key: null,
  nicknames: EMPTY,
  setAll: (key, nicknames) => set({ key, nicknames }),
  setOne: (targetUserId, nickname) => set((s) => {
    const next = { ...s.nicknames }
    if (nickname) next[targetUserId] = nickname
    else delete next[targetUserId]        // blank clears it
    return { nicknames: next }
  }),
}))

/** Called by whoever edits a nickname, so every screen updates at once. */
export function setNicknameLocally(targetUserId, nickname) {
  useNicknameStore.getState().setOne(targetUserId, nickname)
}

/**
 * @param {boolean} refresh  re-read from the server even if a map for this
 *                           family is already loaded. The Family page passes
 *                           this; read-only screens use the cached map.
 */
export function useNicknames(refresh = false) {
  const { user, familyId } = useAuthStore()
  const key = familyId && user ? `${familyId}:${user.id}` : null
  const storeKey  = useNicknameStore((s) => s.key)
  const nicknames = useNicknameStore((s) => s.nicknames)

  useEffect(() => {
    if (!key) return
    if (!refresh && storeKey === key) return
    let cancelled = false
    supabase
      .from('member_nicknames')
      .select('target_user_id, nickname')
      .eq('family_id',     familyId)
      .eq('owner_user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const map = {}
        data.forEach((n) => { if (n.nickname) map[n.target_user_id] = n.nickname })
        useNicknameStore.getState().setAll(key, map)
      })
    return () => { cancelled = true }
  }, [key, refresh])

  const map = storeKey === key ? nicknames : EMPTY

  /** My nickname for this person, or the name they chose for themselves. */
  const nameFor = (userId, fallback) => (userId && map[userId]) || fallback || ''

  return { nicknames: map, nameFor }
}
