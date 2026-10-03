import { describe, it, expect } from 'vitest'
import { estimateArrival } from './eta'

describe('estimateArrival', () => {
  const now = Date.UTC(2026, 9, 1, 6, 0, 0)

  it('gives a plausible time for a town-sized trip', () => {
    // 10 km straight -> 13 km road at 30 km/h = 26 minutes
    const r = estimateArrival(10, now)
    expect(r.minutes).toBe(26)
    expect(r.arriveAt).toBe(now + 26 * 60000)
  })

  it('uses the faster highway speed and 1.2 stretch past 25 km', () => {
    // 42 km straight -> 50.4 km road at 48 km/h = 63 minutes
    expect(estimateArrival(42, now).minutes).toBe(63)
  })

  it('says nothing when effectively there, unknown, or too far to guess', () => {
    expect(estimateArrival(0.1, now)).toBeNull()
    expect(estimateArrival(null, now)).toBeNull()
    expect(estimateArrival(NaN, now)).toBeNull()
    expect(estimateArrival(501, now)).toBeNull()
  })
})
