import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatLocationTime } from './locationTime'

/**
 * Covers "when was this member last located".
 *
 * The bug this function exists to prevent: both map screens printed a bare
 * clock time, so a fix from yesterday read exactly like one from an hour ago.
 * On a screen whose job is telling you where someone is right now, that is the
 * difference between reassuring and wrong — which makes the day boundaries
 * below the whole point, not an edge case.
 */

// Stands in for i18next. Returns the key plus its interpolation so a test can
// assert which phrasing was chosen without depending on the English strings.
const t = (key, vars) => (vars ? `${key}:${vars.time}` : key)

/** Freezes the clock so "today" and "yesterday" are not whatever day it is. */
function freezeAt(iso) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('formatLocationTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('missing input', () => {
    beforeEach(() => freezeAt('2026-09-11T12:00:00'))

    it('renders nothing when there is no timestamp', () => {
      expect(formatLocationTime(t, null)).toBe('')
      expect(formatLocationTime(t, undefined)).toBe('')
      expect(formatLocationTime(t, '')).toBe('')
    })

    it('renders nothing for a zero timestamp rather than 1970', () => {
      expect(formatLocationTime(t, 0)).toBe('')
    })
  })

  describe('day anchoring', () => {
    beforeEach(() => freezeAt('2026-09-11T12:00:00'))

    it('names today', () => {
      expect(formatLocationTime(t, '2026-09-11T09:30:00')).toMatch(/^map\.todayAt:/)
    })

    it('names yesterday', () => {
      expect(formatLocationTime(t, '2026-09-10T23:59:00')).toMatch(/^map\.yesterdayAt:/)
    })

    it('treats one minute after midnight as today, not yesterday', () => {
      freezeAt('2026-09-11T00:05:00')
      expect(formatLocationTime(t, '2026-09-11T00:01:00')).toMatch(/^map\.todayAt:/)
    })

    it('treats one minute before midnight as yesterday', () => {
      freezeAt('2026-09-11T00:05:00')
      expect(formatLocationTime(t, '2026-09-10T23:59:00')).toMatch(/^map\.yesterdayAt:/)
    })

    it('falls back to a date for anything older', () => {
      const out = formatLocationTime(t, '2026-09-09T14:00:00')
      expect(out).not.toMatch(/^map\./)
      expect(out).toMatch(/Sep/)
    })
  })

  describe('date boundaries that arithmetic gets wrong', () => {
    it('handles yesterday across a month boundary', () => {
      freezeAt('2026-09-01T10:00:00')
      expect(formatLocationTime(t, '2026-08-31T22:00:00')).toMatch(/^map\.yesterdayAt:/)
    })

    it('handles yesterday across a year boundary', () => {
      freezeAt('2027-01-01T00:30:00')
      expect(formatLocationTime(t, '2026-12-31T23:45:00')).toMatch(/^map\.yesterdayAt:/)
    })

    it('handles yesterday across a leap day', () => {
      freezeAt('2028-03-01T08:00:00')
      expect(formatLocationTime(t, '2028-02-29T20:00:00')).toMatch(/^map\.yesterdayAt:/)
    })
  })

  describe('the year is shown only when it is not this one', () => {
    beforeEach(() => freezeAt('2026-09-11T12:00:00'))

    it('omits the year for an earlier date this year', () => {
      expect(formatLocationTime(t, '2026-03-04T10:00:00')).not.toMatch(/2026/)
    })

    it('includes the year for a date in a previous year', () => {
      expect(formatLocationTime(t, '2025-12-20T10:00:00')).toMatch(/2025/)
    })

    it('includes the year for a date in a later year', () => {
      expect(formatLocationTime(t, '2027-01-05T10:00:00')).toMatch(/2027/)
    })
  })

  describe('shape of the output', () => {
    beforeEach(() => freezeAt('2026-09-11T12:00:00'))

    it('passes a time string through to the translator', () => {
      const out = formatLocationTime(t, '2026-09-11T09:30:00')
      expect(out).toMatch(/^map\.todayAt:.+/)
      expect(out.split(':').slice(1).join(':')).not.toBe('')
    })

    it('puts the date before the time for older fixes', () => {
      const out = formatLocationTime(t, '2026-09-01T14:20:00')
      expect(out).toMatch(/^[^,]+, .+$/)
    })

    it('accepts an epoch number as well as a string', () => {
      const ms = new Date('2026-09-11T09:30:00').getTime()
      expect(formatLocationTime(t, ms)).toMatch(/^map\.todayAt:/)
    })
  })
})
