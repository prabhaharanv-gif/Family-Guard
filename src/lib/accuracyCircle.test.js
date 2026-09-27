import { describe, it, expect } from 'vitest'
import { accuracyRadius, MAX_RADIUS_M } from './accuracyCircle'

describe('accuracyRadius', () => {
  it('draws no circle for a precise fix', () => {
    expect(accuracyRadius({ accuracy: 6 })).toBeNull()
    expect(accuracyRadius({ accuracy: 50 })).toBeNull()
  })
  it('uses the accuracy as the radius when it is loose', () => {
    expect(accuracyRadius({ accuracy: 56.26 })).toBe(56.26)
    expect(accuracyRadius({ accuracy: 235 })).toBe(235)
  })
  it('caps a wild reading', () => {
    expect(accuracyRadius({ accuracy: 4000 })).toBe(MAX_RADIUS_M)
  })
  it('draws nothing when accuracy is missing or unusable', () => {
    expect(accuracyRadius({})).toBeNull()
    expect(accuracyRadius(null)).toBeNull()
    expect(accuracyRadius({ accuracy: null })).toBeNull()
    expect(accuracyRadius({ accuracy: 0 })).toBeNull()
    expect(accuracyRadius({ accuracy: 'x' })).toBeNull()
  })
})
