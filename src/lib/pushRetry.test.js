import { describe, it, expect } from 'vitest'
import { nextPushRetryDelay, PUSH_RETRY_DELAYS_MS } from './pushRetry'

describe('nextPushRetryDelay', () => {
  it('starts quick and backs off', () => {
    expect(nextPushRetryDelay(0)).toBe(20_000)
    for (let i = 1; i < PUSH_RETRY_DELAYS_MS.length; i++) {
      expect(nextPushRetryDelay(i)).toBeGreaterThan(nextPushRetryDelay(i - 1))
    }
  })

  it('stops after the last attempt rather than retrying forever', () => {
    expect(nextPushRetryDelay(PUSH_RETRY_DELAYS_MS.length)).toBeNull()
    expect(nextPushRetryDelay(99)).toBeNull()
  })

  it('refuses nonsense input', () => {
    expect(nextPushRetryDelay(-1)).toBeNull()
    expect(nextPushRetryDelay(1.5)).toBeNull()
    expect(nextPushRetryDelay(undefined)).toBeNull()
  })
})
