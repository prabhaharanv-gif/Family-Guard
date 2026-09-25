import { describe, it, expect } from 'vitest'
import { fetchLocationHistory, PAGE_ROWS } from './locationHistory'

// A stand-in for supabase-js: rows newest first, max-rows capped at PAGE_ROWS
// like the real API, and every call recorded.
function fakeSupabase(n, { failPage = -1 } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ lat: i, lng: 0, recorded_at: String(n - i).padStart(6, '0') }))
  const calls = []
  const builder = (head) => {
    const q = { filters: [], head }
    const b = {
      eq: (k, v) => { q.filters.push(['eq', k, v]); return b },
      gte: (k, v) => { q.filters.push(['gte', k, v]); return b },
      lte: (k, v) => { q.filters.push(['lte', k, v]); return b },
      order: () => b,
      range: (from, to) => { q.range = [from, to]; return b },
      then: (res, rej) => {
        calls.push(q)
        if (q.head) return Promise.resolve({ count: n, error: null }).then(res, rej)
        const [from, to] = q.range
        if (from / PAGE_ROWS === failPage) return Promise.resolve({ data: null, error: new Error('boom') }).then(res, rej)
        const data = rows.slice(from, Math.min(to + 1, from + PAGE_ROWS))
        return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    return b
  }
  return {
    calls,
    from: () => ({ select: (_cols, opts) => builder(!!opts?.head) }),
  }
}

const args = { userId: 'u', familyId: 'f', since: 'a', until: 'z' }

describe('fetchLocationHistory', () => {
  it('fetches every page past the 1000-row cap, oldest first', async () => {
    const sb = fakeSupabase(2500)
    const rows = await fetchLocationHistory(sb, args)
    expect(rows).toHaveLength(2500)
    expect(rows[0].lat).toBe(2499)           // oldest
    expect(rows[2499].lat).toBe(0)           // newest
    expect(sb.calls.filter(c => !c.head).map(c => c.range)).toEqual(
      expect.arrayContaining([[0, 999], [1000, 1999], [2000, 2499]]),
    )
  })

  it('every request is scoped to the member, the family and a fixed window', async () => {
    const sb = fakeSupabase(10)
    await fetchLocationHistory(sb, args)
    for (const c of sb.calls) {
      expect(c.filters).toEqual([['eq', 'user_id', 'u'], ['eq', 'family_id', 'f'], ['gte', 'recorded_at', 'a'], ['lte', 'recorded_at', 'z']])
    }
  })

  it('over the cap, keeps the newest rows', async () => {
    const rows = await fetchLocationHistory(fakeSupabase(5000), { ...args, maxRows: 1500 })
    expect(rows).toHaveLength(1500)
    expect(rows[rows.length - 1].lat).toBe(0)   // the newest is kept
  })

  it('no rows is an empty list, with no page requests', async () => {
    const sb = fakeSupabase(0)
    expect(await fetchLocationHistory(sb, args)).toEqual([])
    expect(sb.calls).toHaveLength(1)
  })

  it('a failed page fails the whole load rather than returning a hole', async () => {
    await expect(fetchLocationHistory(fakeSupabase(3000, { failPage: 1 }), args)).rejects.toThrow('boom')
  })
})
