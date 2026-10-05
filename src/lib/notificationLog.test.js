import { describe, it, expect } from 'vitest'
import { groupByDay } from './notificationLog'

// Local time on purpose: "today" is the person's today, not UTC's.
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const item = (t, title) => ({ t, type: 'place_enter', title, body: '', route: '/' })

describe('groupByDay', () => {
  const now = at(2026, 10, 5, 15)

  it('labels today, yesterday and older days, newest first', () => {
    const list = [
      item(at(2026, 10, 5, 14), 'a'),
      item(at(2026, 10, 5, 9),  'b'),
      item(at(2026, 10, 4, 22), 'c'),
      item(at(2026, 10, 2, 8),  'd'),
    ]
    const g = groupByDay(list, now)
    expect(g.map(x => x.day)).toEqual(['today', 'yesterday', 'earlier'])
    expect(g[0].items.map(x => x.title)).toEqual(['a', 'b'])
    expect(g[1].items.map(x => x.title)).toEqual(['c'])
    expect(g[2].date).toBe(at(2026, 10, 2, 0))
  })

  it('splits two different older days into two groups', () => {
    const list = [item(at(2026, 10, 2, 8), 'x'), item(at(2026, 10, 1, 8), 'y')]
    expect(groupByDay(list, now).map(x => x.day)).toEqual(['earlier', 'earlier'])
  })

  it('treats just after midnight as today', () => {
    const g = groupByDay([item(at(2026, 10, 5, 0, 1), 'late')], now)
    expect(g[0].day).toBe('today')
  })

  it('gives nothing for an empty list', () => {
    expect(groupByDay([], now)).toEqual([])
  })
})
