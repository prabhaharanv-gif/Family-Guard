import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clampMuteLevel,
  readMuteLevel,
  writeMuteLevel,
  MUTE_LEVEL_KEY,
  MUTE_LEVELS,
} from './muteLevel'

/**
 * Covers the mute level: 0 = on, 1 = sound off, 2 = fully muted.
 *
 * This module exists because a corrupt or out-of-range stored value used to
 * reach `MUTE_STATES[muteLevel]` on the Messages page and crash the entire app
 * with "Cannot read properties of undefined". Every test below is really the
 * same assertion: whatever is in storage, the value handed back is a usable
 * index. Nothing here may ever return undefined, NaN, or a number outside the
 * range.
 */

/** localStorage is not present in the default vitest environment. */
function installStorage(initial = {}) {
  const store = { ...initial }
  const storage = {
    getItem: vi.fn(k => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v) }),
    removeItem: vi.fn(k => { delete store[k] }),
    _store: store,
  }
  vi.stubGlobal('localStorage', storage)
  return storage
}

/** Storage that throws, as in a WebView with site data blocked. */
function installBrokenStorage() {
  const storage = {
    getItem: vi.fn(() => { throw new Error('denied') }),
    setItem: vi.fn(() => { throw new Error('denied') }),
  }
  vi.stubGlobal('localStorage', storage)
  return storage
}

describe('clampMuteLevel', () => {
  it('keeps every valid level', () => {
    for (let i = 0; i < MUTE_LEVELS; i++) {
      expect(clampMuteLevel(i)).toBe(i)
    }
  })

  it('reads the numeric strings localStorage actually returns', () => {
    expect(clampMuteLevel('0')).toBe(0)
    expect(clampMuteLevel('1')).toBe(1)
    expect(clampMuteLevel('2')).toBe(2)
  })

  it('falls back to 0 for values past the end of the range', () => {
    expect(clampMuteLevel(MUTE_LEVELS)).toBe(0)
    expect(clampMuteLevel(99)).toBe(0)
  })

  it('falls back to 0 for negative values', () => {
    expect(clampMuteLevel(-1)).toBe(0)
  })

  it('falls back to 0 for anything unparseable', () => {
    expect(clampMuteLevel('muted')).toBe(0)
    expect(clampMuteLevel('')).toBe(0)
    expect(clampMuteLevel(null)).toBe(0)
    expect(clampMuteLevel(undefined)).toBe(0)
    expect(clampMuteLevel({})).toBe(0)
    expect(clampMuteLevel([])).toBe(0)
    expect(clampMuteLevel(NaN)).toBe(0)
  })

  it('falls back to 0 for infinities rather than indexing with them', () => {
    expect(clampMuteLevel(Infinity)).toBe(0)
    expect(clampMuteLevel(-Infinity)).toBe(0)
  })

  it('truncates a fractional level to a usable index', () => {
    expect(clampMuteLevel(1.7)).toBe(1)
    expect(clampMuteLevel('1.2')).toBe(1)
  })

  /** The actual crash condition, stated directly. */
  it('never returns something that cannot index a 3-element array', () => {
    const hostile = [
      -5, 3, 4, 1000, NaN, Infinity, -Infinity, 1.9, '2.9',
      null, undefined, '', 'x', {}, [], true, false,
    ]
    for (const value of hostile) {
      const level = clampMuteLevel(value)
      expect(Number.isInteger(level)).toBe(true)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThan(MUTE_LEVELS)
    }
  })
})

describe('readMuteLevel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 0 when nothing has been stored', () => {
    installStorage()
    expect(readMuteLevel()).toBe(0)
  })

  it('returns a stored level', () => {
    installStorage({ [MUTE_LEVEL_KEY]: '2' })
    expect(readMuteLevel()).toBe(2)
  })

  it('repairs a corrupt entry so garbage is not re-parsed on every read', () => {
    const storage = installStorage({ [MUTE_LEVEL_KEY]: 'nonsense' })

    expect(readMuteLevel()).toBe(0)
    expect(storage.setItem).toHaveBeenCalledWith(MUTE_LEVEL_KEY, '0')
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('0')
  })

  it('repairs an out-of-range entry', () => {
    const storage = installStorage({ [MUTE_LEVEL_KEY]: '7' })

    expect(readMuteLevel()).toBe(0)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('0')
  })

  it('leaves a valid entry alone', () => {
    const storage = installStorage({ [MUTE_LEVEL_KEY]: '1' })

    expect(readMuteLevel()).toBe(1)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('survives storage that throws', () => {
    installBrokenStorage()
    expect(readMuteLevel()).toBe(0)
  })
})

describe('writeMuteLevel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores a valid level and returns it', () => {
    const storage = installStorage()

    expect(writeMuteLevel(2)).toBe(2)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('2')
  })

  it('never stores an invalid level', () => {
    const storage = installStorage()

    expect(writeMuteLevel(99)).toBe(0)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('0')
  })

  it('returns the clamped level even when storage throws', () => {
    installBrokenStorage()
    expect(writeMuteLevel(1)).toBe(1)
  })

  it('round-trips through storage', () => {
    installStorage()
    for (let i = 0; i < MUTE_LEVELS; i++) {
      writeMuteLevel(i)
      expect(readMuteLevel()).toBe(i)
    }
  })
})
