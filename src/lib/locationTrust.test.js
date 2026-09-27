import { describe, it, expect } from 'vitest'
import {
  isStaleFix, hasStrongMotionEvidence, accuracyLimit,
  MAX_ACCURACY_M, EVIDENCE_ACCURACY_M, FIRST_FIX_ACCURACY_M, STALE_FIX_MS,
} from './locationTrust'

describe('isStaleFix', () => {
  it('rejects a cached fix and keeps a live one', () => {
    expect(isStaleFix(1000, 1000 + STALE_FIX_MS + 1)).toBe(true)
    expect(isStaleFix(1000, 1000 + STALE_FIX_MS)).toBe(false)
  })
  it('cannot judge a fix with no timestamp, so does not reject it', () => {
    expect(isStaleFix(undefined)).toBe(false)
    expect(isStaleFix(null)).toBe(false)
  })
})

describe('hasStrongMotionEvidence', () => {
  it('needs a reported speed AND matching displacement', () => {
    expect(hasStrongMotionEvidence({ speedMps: 8, movedM: 400, msSinceLast: 20_000 })).toBe(true)
    expect(hasStrongMotionEvidence({ speedMps: 8, movedM: 5, msSinceLast: 20_000 })).toBe(false)
    expect(hasStrongMotionEvidence({ speedMps: 0.2, movedM: 400, msSinceLast: 20_000 })).toBe(false)
  })
  it('is false when speed is unknown', () => {
    expect(hasStrongMotionEvidence({ speedMps: null, movedM: 400, msSinceLast: 20_000 })).toBe(false)
  })
})

describe('accuracyLimit', () => {
  const still = { hasBaseline: true, speedMps: 0, movedM: 10, msSinceLast: 30_000 }
  it('is 100m for a member with a position on the map', () => {
    expect(accuracyLimit(still)).toBe(MAX_ACCURACY_M)
  })
  it('never exceeds 200m, and only rises to it for a member who is clearly moving', () => {
    expect(accuracyLimit({ ...still, speedMps: 9, movedM: 300 })).toBe(EVIDENCE_ACCURACY_M)
  })
  it('lets the very first fix through so the member is not invisible', () => {
    expect(accuracyLimit({ hasBaseline: false })).toBe(FIRST_FIX_ACCURACY_M)
  })
})
