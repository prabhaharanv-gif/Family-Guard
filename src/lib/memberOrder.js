/**
 * memberOrder.js
 *
 * The order of the member cards on the Family page: the family admin (the owner)
 * first, then everyone else in the order they joined. The second person added
 * is second, the third is third, and so on.
 *
 * The database returns members in no particular order, and the list is rebuilt
 * from several places, so the order is applied once, where the cards are drawn.
 *
 * `ownerId` is families.created_by. It follows an ownership transfer, so the
 * card at the top is always whoever owns the family now. Until it is known, a
 * member whose role is 'admin' is treated as the owner so the list does not
 * visibly reshuffle when it arrives.
 */
const joinedAt = (m) => {
  const t = Date.parse(m?.joined_at)
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

export function orderMembers(members, ownerId) {
  const rank = (m) => {
    if (ownerId) return m.user_id === ownerId ? 0 : 1
    return m.role === 'admin' ? 0 : 1
  }
  return [...(members || [])].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    const ta = joinedAt(a), tb = joinedAt(b)
    if (ta !== tb) return ta < tb ? -1 : 1
    // Same instant (or both unknown): a stable, arbitrary-but-consistent order.
    return String(a.user_id).localeCompare(String(b.user_id))
  })
}
