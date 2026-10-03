import { describe, it, expect } from 'vitest'
import { formatCount, formatKm } from './numberFormat'

describe('formatCount', () => {
  it('groups the Indian way', () => {
    expect(formatCount(14247)).toBe('14,247')
    expect(formatCount(142470)).toBe('1,42,470')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1234.5, 1)).toBe('1,234.5')
  })
  it('gives nothing for a non-number', () => {
    expect(formatCount(NaN)).toBe('')
    expect(formatCount(undefined)).toBe('')
  })
})

describe('formatKm', () => {
  it('uses one decimal under 10 km and a whole number after', () => {
    expect(formatKm(2.94)).toBe('2.9')
    expect(formatKm(9.96)).toBe('10')
    expect(formatKm(42.4)).toBe('42')
    expect(formatKm(14247.4)).toBe('14,247')
    expect(formatKm(142470.2)).toBe('1,42,470')
  })
})
