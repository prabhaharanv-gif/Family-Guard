import { describe, expect, it } from 'vitest'
import { arrivalTextAt, haversineKm } from './eta'

// Local-time constructor so the tests do not depend on the machine's time zone.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime()

describe('arrivalTextAt', () => {
  it('is only the clock time when the arrival is still today', () => {
    const now = at(2026, 10, 1, 9, 0)
    const out = arrivalTextAt(now + 30 * 60000, now)
    expect(out).toMatch(/9:30|09:30/)
    expect(out).not.toMatch(/Oct/)
  })

  it('carries the date once the arrival is on another day', () => {
    // 60 minutes after 11:30 PM lands after midnight.
    const now = at(2026, 10, 1, 23, 30)
    const out = arrivalTextAt(now + 60 * 60000, now)
    expect(out).toMatch(/2 Oct|Oct 2/)
    expect(out).toMatch(/12:30|00:30/)
  })

  it('shows the date for a trip that ends days from now', () => {
    const now = at(2026, 10, 1, 10, 0)
    expect(arrivalTextAt(now + 3 * 86_400_000, now)).toMatch(/Oct/)
  })

  it('adds the year only when the arrival is in another year', () => {
    const dec = at(2026, 12, 31, 23, 30)
    expect(arrivalTextAt(dec + 60 * 60000, dec)).toMatch(/2027/)
    const oct = at(2026, 10, 1, 23, 30)
    expect(arrivalTextAt(oct + 60 * 60000, oct)).not.toMatch(/2026/)
  })
})

describe('haversineKm', () => {
  it('is null when a coordinate is missing', () => {
    expect(haversineKm(11, 77, null, 77)).toBeNull()
  })

  it('is about 111 km per degree of latitude', () => {
    expect(haversineKm(11, 77, 12, 77)).toBeCloseTo(111.2, 0)
  })
})
