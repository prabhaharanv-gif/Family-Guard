import { describe, it, expect } from 'vitest'
import { buildRoute, distanceM, positionAt, silences, stayAt, clockLabel, dateLabel, daysBetween, rowsOnDay, timelineSince, outwardDir } from './route'

const at = (min) => new Date(Date.UTC(2026, 8, 22, 6, 0) + min * 60000).toISOString()
// About 111 m per 0.001 degree of latitude.
const row = (dLat, min) => ({ lat: 11 + dLat, lng: 77, recorded_at: at(min) })

describe('buildRoute', () => {
  it('keeps points a real distance apart and adds up the kilometres', () => {
    const { path, km } = buildRoute([row(0, 0), row(0.01, 5), row(0.02, 10)])
    expect(path).toHaveLength(3)
    expect(km).toBeCloseTo(2.2, 1)
  })

  it('drops jitter closer than 20 m to the last kept point', () => {
    const { path } = buildRoute([row(0, 0), row(0.0001, 1), row(0.00015, 2), row(0.001, 3)])
    expect(path).toHaveLength(2)
  })

  it('drops a fix that would need an impossible speed, and carries on after it', () => {
    // 50 km away one minute later is 3000 km/h: a glitch.
    const { path } = buildRoute([row(0, 0), row(0.45, 1), row(0.002, 2)])
    expect(path.map(p => p.lat)).toEqual([11, 11.002])
  })

  it('ignores missing and 0,0 rows', () => {
    const { path } = buildRoute([{ lat: 0, lng: 0, recorded_at: at(0) }, { lat: null, lng: 77, recorded_at: at(1) }, row(0, 2)])
    expect(path).toHaveLength(1)
  })

  it('an empty day is an empty route', () => {
    expect(buildRoute([])).toEqual({ path: [], segments: [], stays: [], track: [], km: 0 })
    expect(buildRoute(null)).toEqual({ path: [], segments: [], stays: [], track: [], km: 0 })
  })
})

describe('distanceM', () => {
  it('matches a known distance', () => {
    expect(distanceM({ lat: 11, lng: 77 }, { lat: 11.001, lng: 77 })).toBeCloseTo(111.2, 0)
  })
})

describe('buildRoute gaps', () => {
  it('a silence over 10 minutes starts a new segment and is not counted as travel', () => {
    // 222 m in a minute, then silent for 34 min and 6 km further on, then 222 m more.
    const { segments, km, path } = buildRoute([row(0, 0), row(0.002, 1), row(0.06, 35), row(0.062, 36)])
    expect(segments).toHaveLength(2)
    expect(segments.map(s => s.length)).toEqual([2, 2])
    expect(path).toHaveLength(4)
    expect(km).toBeCloseTo(0.4, 1)
  })

  it('standing still keeps the clock moving, so the next step is not a false gap', () => {
    // Parked for 20 minutes with fixes every 5 minutes, then moves on.
    const rows = [row(0, 0), row(0.00001, 5), row(0.00002, 10), row(0.00001, 15), row(0.00002, 20), row(0.002, 21)]
    expect(buildRoute(rows).segments).toHaveLength(1)
  })

  it('a far jump after a long gap is kept: it is a new place, not a glitch', () => {
    // 60 km away 2 hours later: 30 km/h over the gap, and a new segment.
    const { segments } = buildRoute([row(0, 0), row(0.54, 120)])
    expect(segments).toHaveLength(2)
  })
})

const local = (h, m = 0) => new Date(2026, 8, 22, h, m).toISOString()
const r = (dLat, h, m) => ({ lat: 11 + dLat, lng: 77, recorded_at: local(h, m) })
const ms = (h, m = 0) => new Date(2026, 8, 22, h, m).getTime()

describe('hops', () => {
  it('a long jump between two reports is not drawn, but still counts', () => {
    // 222 m in a minute, then 6.4 km in 9 minutes (under the 10-minute gap), then on.
    const { segments, km, track } = buildRoute([r(0, 8, 0), r(0.002, 8, 1), r(0.06, 8, 10), r(0.061, 8, 11)])
    expect(segments.map(s => s.length)).toEqual([2, 2])    // no line 8:01 → 8:10
    expect(km).toBeCloseTo(6.8, 1)                          // they did get there
    expect(silences(track)).toEqual([])                     // and it is not "no GPS"
  })

  it('a slow hop — 400 m in 5 minutes — is not drawn either', () => {
    const { segments } = buildRoute([r(0, 8, 0), r(0.0036, 8, 5)])
    expect(segments.map(s => s.length)).toEqual([1, 1])
  })

  it('driving with frequent reports stays one line', () => {
    // 20 reports, ~110 m and 10 s apart: 40 km/h.
    const rows = Array.from({ length: 20 }, (_, i) => ({ lat: 11 + i * 0.001, lng: 77, recorded_at: new Date(2026, 8, 22, 8, 0, i * 10).toISOString() }))
    expect(buildRoute(rows).segments).toHaveLength(1)
  })
})

describe('uncluttering', () => {
  it('a long silence spent nearby does not break the line', () => {
    // 30 minutes silent but only ~220 m further on: one segment.
    expect(buildRoute([r(0, 8, 0), r(0.002, 8, 30)]).segments).toHaveLength(1)
  })

  it('callouts point away from the middle of the route', () => {
    const path = [{ lat: 11, lng: 77 }, { lat: 11.1, lng: 77.1 }]
    const east = outwardDir({ lat: 11.05, lng: 77.1 }, path)
    expect(east.x).toBeGreaterThan(0.99)
    const north = outwardDir({ lat: 11.1, lng: 77.05 }, path)
    expect(north.y).toBeLessThan(-0.99)   // screen y is down, so north is negative
    expect(outwardDir({ lat: 11.05, lng: 77.05 }, path)).toEqual({ x: 0.7071, y: -0.7071 })
  })
})

describe('stays', () => {
  it('20 minutes in one place is a stay, with its times', () => {
    const rows = [
      r(0, 8, 0), r(0.01, 8, 3), r(0.02, 8, 6),                      // driving
      r(0.0201, 8, 10), r(0.0202, 8, 20), r(0.02005, 8, 28),         // parked ~22 min
      r(0.03, 8, 32), r(0.04, 8, 35),                                // driving on
    ]
    const { stays } = buildRoute(rows)
    expect(stays).toHaveLength(1)
    expect(stays[0].lat).toBeCloseTo(11.02, 3)
    expect(stays[0].from).toBe(ms(8, 6))
    expect(stays[0].to).toBe(ms(8, 28))
  })

  it('a 10-minute stop is not a stay', () => {
    const rows = [r(0, 8, 0), r(0.01, 8, 3), r(0.0101, 8, 8), r(0.01, 8, 13), r(0.02, 8, 16)]
    expect(buildRoute(rows).stays).toHaveLength(0)
  })

  it('stayAt finds the stay a time falls in', () => {
    const stays = [{ from: ms(9), to: ms(10) }, { from: ms(13), to: ms(14) }]
    expect(stayAt(stays, ms(9, 30))).toBe(stays[0])
    expect(stayAt(stays, ms(14))).toBe(stays[1])
    expect(stayAt(stays, ms(11))).toBeNull()
  })
})

describe('the time slider', () => {
  it('the track keeps every believable fix with its time, jitter included', () => {
    const { track, path } = buildRoute([r(0, 8, 0), r(0.00005, 8, 5), r(0.01, 8, 10)])
    expect(path).toHaveLength(2)              // the 5 m wander is not drawn...
    expect(track.map(p => p.t)).toEqual([ms(8), ms(8, 5), ms(8, 10)])   // ...but it is still a known time
  })

  it('the track leaves out glitches', () => {
    const { track } = buildRoute([r(0, 8, 0), r(0.45, 8, 1), r(0.002, 8, 2)])
    expect(track).toHaveLength(2)
  })

  it('between two fixes the position is interpolated by time', () => {
    const { track } = buildRoute([r(0, 8, 0), r(0.01, 8, 10)])
    const p = positionAt(track, ms(8, 5))
    expect(p.gap).toBe(false)
    expect(p.lat).toBeCloseTo(11.005, 6)
  })

  it('before the first fix and after the last, it holds the ends', () => {
    const { track } = buildRoute([r(0, 8, 0), r(0.01, 8, 10)])
    expect(positionAt(track, ms(7)).lat).toBe(11)
    expect(positionAt(track, ms(9)).lat).toBe(11.01)
  })

  it('inside a gap it is the last place heard from, flagged', () => {
    // Silent 8:05 to 8:40 while moving 5.5 km: a gap.
    const { track } = buildRoute([r(0, 8, 0), r(0.01, 8, 5), r(0.06, 8, 40), r(0.07, 8, 45)])
    const p = positionAt(track, ms(8, 20))
    expect(p).toEqual({ lat: 11.01, lng: 77, gap: true, lastSeen: ms(8, 5) })
  })

  it('a long silence in one place is still no signal', () => {
    // Phone quiet 8:05 to 9:00 without moving: one line segment, but no GPS.
    const { track, segments } = buildRoute([r(0, 8, 0), r(0.00001, 8, 5), r(0.00002, 9, 0)])
    expect(segments).toHaveLength(1)
    expect(positionAt(track, ms(8, 30))).toMatchObject({ gap: true, lastSeen: ms(8, 5) })
    expect(silences(track)).toEqual([{ from: ms(8, 5), to: ms(9, 0) }])
  })

  it('fixes every few minutes are not silences', () => {
    const { track } = buildRoute([r(0, 8, 0), r(0.01, 8, 5), r(0.02, 8, 14)])
    expect(silences(track)).toEqual([])
    expect(positionAt(track, ms(8, 10)).gap).toBe(false)
  })

  it('dateLabel gives day and short month', () => {
    expect(dateLabel(ms(9))).toMatch(/22.*Sep|Sep.*22/)
  })

  it('daysBetween lists every calendar day the span touches', () => {
    // 15 Sept 6.50 PM to 22 Sept 6.49 PM: eight dates.
    const days = daysBetween(new Date(2026, 8, 15, 18, 50).getTime(), new Date(2026, 8, 22, 18, 49).getTime())
    expect(days).toHaveLength(8)
    expect(days[0]).toBe(new Date(2026, 8, 15).getTime())
    expect(days[7]).toBe(new Date(2026, 8, 22).getTime())
  })

  it('Last 7 Days is today and the six days before it', () => {
    const now = new Date(2026, 8, 22, 18, 49).getTime()
    expect(timelineSince('7d', now)).toBe(new Date(2026, 8, 16).getTime())
    expect(daysBetween(timelineSince('7d', now), now)).toHaveLength(7)
    expect(timelineSince('24h', now)).toBe(now - 24 * 3600000)
  })

  it('rowsOnDay keeps midnight to midnight, local time', () => {
    const rows = [r(0, 23, 59), { lat: 11, lng: 77, recorded_at: new Date(2026, 8, 23, 0, 0).toISOString() }, r(0, 0, 0)]
    expect(rowsOnDay(rows, new Date(2026, 8, 22).getTime())).toEqual([rows[0], rows[2]])
  })

  it('an empty track has no position', () => {
    expect(positionAt([], ms(8))).toBeNull()
  })

  it('clockLabel reads like a clock, to the minute', () => {
    expect(clockLabel(ms(0, 0))).toBe('12.00 AM')
    expect(clockLabel(ms(9, 5))).toBe('9.05 AM')
    expect(clockLabel(ms(12, 30))).toBe('12.30 PM')
    expect(clockLabel(ms(15, 40), 'am', 'pm')).toBe('3.40 pm')
  })
})
