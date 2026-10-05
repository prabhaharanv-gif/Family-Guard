import { describe, it, expect } from 'vitest'
import { aqiKey, hourText, dayText, rainPercent, trustedCode } from './weatherDetail'

describe('aqiKey', () => {
  it('names the five levels and nothing else', () => {
    expect(aqiKey(1)).toBe('good')
    expect(aqiKey(3)).toBe('moderate')
    expect(aqiKey(5)).toBe('veryPoor')
    expect(aqiKey(0)).toBeNull()
    expect(aqiKey(6)).toBeNull()
    expect(aqiKey(null)).toBeNull()
    expect(aqiKey(2.5)).toBeNull()
  })
})

describe('hourText', () => {
  // 12:30 PM IST on 1 Oct 2026 is 07:00 UTC; IST is +19800 s.
  const noonIst = Date.UTC(2026, 9, 1, 7, 0, 0)
  it('reads the place local hour on a 12 hour clock', () => {
    expect(hourText(noonIst, 19800, 'AM', 'PM')).toBe('12 PM')
    expect(hourText(noonIst + 3 * 3600e3, 19800, 'AM', 'PM')).toBe('3 PM')
    expect(hourText(noonIst + 12 * 3600e3, 19800, 'AM', 'PM')).toBe('12 AM')
    expect(hourText(noonIst + 15 * 3600e3, 19800, 'AM', 'PM')).toBe('3 AM')
  })
  it('uses the given AM/PM words', () => {
    expect(hourText(noonIst, 19800, 'முற்பகல்', 'பிற்பகல்')).toBe('12 பிற்பகல்')
  })
})

describe('dayText', () => {
  it('gives the weekday at the place, not at the viewer', () => {
    // 23:00 UTC on Thu 1 Oct 2026 is already Fri 2 Oct in India.
    const t = Date.UTC(2026, 9, 1, 23, 0, 0)
    expect(dayText(t, 19800, 'en')).toBe('Fri')
    expect(dayText(t, 0, 'en')).toBe('Thu')
  })
})

describe('rainPercent', () => {
  it('rounds and clamps, and says nothing for junk', () => {
    expect(rainPercent(60.4)).toBe(60)
    expect(rainPercent(130)).toBe(100)
    expect(rainPercent(-5)).toBe(0)
    expect(rainPercent(null)).toBeNull()
    expect(rainPercent(undefined)).toBeNull()
    expect(rainPercent('abc')).toBeNull()
  })
})

import { hourlyStrip } from './weatherDetail'
describe('hourlyStrip and low-chance rain', () => {
  const H = 3600000
  const base = Date.UTC(2026, 9, 1, 10, 20) // 10:20 UTC, tz 0
  const now = { temp: 30, code: 1, isDay: true }
  const steps = [0, 1, 2, 3, 4, 5].map(i => ({ ts: Date.UTC(2026, 9, 1, 12) + i * 3 * H, temp: 30 + i * 3, code: 2, isDay: true }))
  it('steps an hour apart on whole hours', () => {
    const one = hourlyStrip({ now, nowTs: base, steps, tz: 0, count: 6 })
    expect(one.map(h => new Date(h.ts).getUTCHours()).slice(1)).toEqual([11, 12, 13, 14, 15])
  })
  it('interpolates temperature and keeps the current reading first', () => {
    const s = hourlyStrip({ now, nowTs: base, steps, tz: 0 })
    expect(s[0].temp).toBe(30)
    expect(s[3].temp).toBe(31) // 13:00, a third of the way from 30 (12:00) to 33 (15:00)
  })
  it('aligns to local hours at a half-hour offset', () => {
    const s = hourlyStrip({ now, nowTs: base, steps, tz: 19800 })
    expect((s[1].ts + 19800000) % H).toBe(0)
  })
})

import { dateText } from './weatherDetail'
describe('dateText', () => {
  it('shows day and short month at the place, not on the phone', () => {
    // 23:30 UTC on 1 Oct is already 2 Oct at +5:30
    const ts = Date.UTC(2026, 9, 1, 23, 30)
    expect(dateText(ts, 19800, 'en-GB')).toBe('02 Oct')
    expect(dateText(ts, 0, 'en-US')).toBe('01 Oct')
  })
})

describe('hourlyStrip over a full day', () => {
  const H = 3600000
  it('runs through midnight to 24 hours ahead', () => {
    const nowTs = Date.UTC(2026, 9, 1, 15, 48) // 3:48 PM
    const steps = Array.from({ length: 9 }, (_, i) => ({ ts: Date.UTC(2026, 9, 1, 18) + i * 3 * H, temp: 30 - i, code: 3, isDay: true }))
    const s = hourlyStrip({ now: { temp: 33, code: 3, isDay: true }, nowTs, steps, tz: 0 })
    const hrs = s.map(h => new Date(h.ts).getUTCHours())
    expect(hrs.slice(0, 11)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1])
    expect(s.length).toBe(25)
    expect(s[s.length - 1].ts - nowTs).toBeLessThanOrEqual(24 * H)
  })
})

describe('trustedCode', () => {
  it('draws rain as cloud when the chance of rain is low', () => {
    expect(trustedCode(61, 14)).toBe(3)    // light rain at 14%
    expect(trustedCode(80, 39)).toBe(3)    // showers just under the line
    expect(trustedCode(53, 0)).toBe(3)     // drizzle
  })
  it('keeps rain when the chance is real or unknown', () => {
    expect(trustedCode(61, 40)).toBe(61)
    expect(trustedCode(65, 90)).toBe(65)
    expect(trustedCode(61, null)).toBe(61)
  })
  it('leaves everything that is not rain alone', () => {
    expect(trustedCode(0, 0)).toBe(0)
    expect(trustedCode(2, 5)).toBe(2)
    expect(trustedCode(95, 10)).toBe(95)   // a thunderstorm is not softened
  })
})

describe('hourlyStrip and low-chance rain', () => {
  const H = 3600000
  const base = Date.UTC(2026, 9, 5, 6, 0)       // a whole hour, so the cells fall on the steps
  const now = { temp: 32, code: 61, isDay: true, pop: 10 }
  const steps = [
    { ts: base + 2 * H, temp: 30, code: 61, isDay: true,  pop: 12 },   // light rain, 12%
    { ts: base + 5 * H, temp: 28, code: 63, isDay: false, pop: 70 },   // moderate rain, 70%
  ]
  const out = hourlyStrip({ now, nowTs: base, steps, tz: 0, count: 25 })

  it('leaves the current reading as the provider reported it', () => {
    expect(out[0].code).toBe(61)
  })
  it('draws a low-chance rain step as cloud and a likely one as rain', () => {
    const low = out.find(c => c.ts >= base + 2 * H && c.ts < base + 5 * H)
    const likely = out.find(c => c.ts >= base + 5 * H)
    expect(low.code).toBe(3)
    expect(likely.code).toBe(63)
  })
})
