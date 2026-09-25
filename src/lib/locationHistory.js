/**
 * Loading a member's location_history for the Timeline.
 *
 * A row is written on every location update, so a week can be tens of
 * thousands of rows — and the API hands back at most 1000 per request (the
 * project's max-rows), whatever .limit() asks for. One request would quietly
 * return a fragment. So: count first, then fetch the pages in parallel.
 *
 * Pages run newest first against a fixed upper bound, `until`: rows written
 * while loading land after it and cannot shift the offsets, which would
 * otherwise repeat or skip rows at page boundaries. If there are more than
 * maxRows, the newest are kept — the latest part of the history is what
 * people look at first.
 */

export const PAGE_ROWS = 1000
export const MAX_ROWS = 60000
const PARALLEL = 6

/**
 * @returns rows [{ lat, lng, recorded_at }] oldest first
 * @throws the Supabase error if any request fails
 */
export async function fetchLocationHistory(supabase, {
  userId, familyId, since, until = new Date().toISOString(), maxRows = MAX_ROWS,
}) {
  const scoped = q => q
    .eq('user_id', userId)
    .eq('family_id', familyId)
    .gte('recorded_at', since)
    .lte('recorded_at', until)

  const { count, error } = await scoped(
    supabase.from('location_history').select('id', { count: 'exact', head: true }),
  )
  if (error) throw error
  const total = Math.min(count || 0, maxRows)
  const pages = Math.ceil(total / PAGE_ROWS)

  const out = new Array(pages)
  let next = 0
  async function worker() {
    while (next < pages) {
      const i = next++
      const from = i * PAGE_ROWS
      const to = Math.min(from + PAGE_ROWS, total) - 1
      const { data, error: e } = await scoped(
        supabase.from('location_history').select('lat, lng, recorded_at'),
      ).order('recorded_at', { ascending: false }).range(from, to)
      if (e) throw e
      out[i] = data || []
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pages) }, worker))
  return out.flat().reverse()
}
