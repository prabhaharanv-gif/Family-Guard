import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clampMuteLevel,
  readMuteLevel,
  writeMuteLevel,
  MUTE_LEVEL_KEY,
  MUTE,
} from './muteLevel'

/**
 * Covers the mute level: 0 = on, 1 = sound & pop-up muted, 3 = sound muted,
 * 4 = pop-up muted, and 2 = the retired "all off", read back as 1.
 *
 * This module exists because a corrupt or out-of-range stored value used to
 * reach `MUTE_STATES[muteLevel]` on the Messages page and crash the entire app
 * with "Cannot read properties of undefined". Most tests below are really the
 * same assertion: whatever is in storage, the value handed back is one of the
 * levels the page has a state for. Nothing here may ever return undefined,
 * NaN, or a number outside that set.
 */

const LEVELS = Object.values(MUTE)

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

describe('MUTE', () => {
  /** The native side reads these same integers out of SharedPreferences. */
  it('keeps the numbers the native side expects', () => {
    expect(MUTE).toEqual({ NONE: 0, SOUND_AND_POPUP: 1, SOUND: 3, POPUP: 4 })
  })
})

describe('clampMuteLevel', () => {
  it('keeps every valid level', () => {
    for (const level of LEVELS) {
      expect(clampMuteLevel(level)).toBe(level)
    }
  })

  it('reads the numeric strings localStorage actually returns', () => {
    expect(clampMuteLevel('0')).toBe(MUTE.NONE)
    expect(clampMuteLevel('1')).toBe(MUTE.SOUND_AND_POPUP)
    expect(clampMuteLevel('3')).toBe(MUTE.SOUND)
    expect(clampMuteLevel('4')).toBe(MUTE.POPUP)
  })

  it('moves the retired "all off" level to sound & pop-up muted', () => {
    expect(clampMuteLevel(2)).toBe(MUTE.SOUND_AND_POPUP)
    expect(clampMuteLevel('2')).toBe(MUTE.SOUND_AND_POPUP)
  })

  it('falls back to 0 for values past the end of the range', () => {
    expect(clampMuteLevel(5)).toBe(0)
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

  it('truncates a fractional level to a usable one', () => {
    expect(clampMuteLevel(1.7)).toBe(1)
    expect(clampMuteLevel('3.2')).toBe(3)
  })

  /** The actual crash condition, stated directly. */
  it('never returns something outside the known levels', () => {
    const hostile = [
      -5, 2, 5, 1000, NaN, Infinity, -Infinity, 1.9, '2.9', '4.5',
      null, undefined, '', 'x', {}, [], true, false,
    ]
    for (const value of hostile) {
      expect(LEVELS).toContain(clampMuteLevel(value))
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
    installStorage({ [MUTE_LEVEL_KEY]: '4' })
    expect(readMuteLevel()).toBe(MUTE.POPUP)
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

  it('rewrites the retired "all off" entry as sound & pop-up muted', () => {
    const storage = installStorage({ [MUTE_LEVEL_KEY]: '2' })

    expect(readMuteLevel()).toBe(MUTE.SOUND_AND_POPUP)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('1')
  })

  it('leaves a valid entry alone', () => {
    const storage = installStorage({ [MUTE_LEVEL_KEY]: '3' })

    expect(readMuteLevel()).toBe(MUTE.SOUND)
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

    expect(writeMuteLevel(MUTE.POPUP)).toBe(MUTE.POPUP)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('4')
  })

  it('never stores an invalid level', () => {
    const storage = installStorage()

    expect(writeMuteLevel(99)).toBe(0)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('0')
  })

  it('never stores the retired level', () => {
    const storage = installStorage()

    expect(writeMuteLevel(2)).toBe(MUTE.SOUND_AND_POPUP)
    expect(storage._store[MUTE_LEVEL_KEY]).toBe('1')
  })

  it('returns the clamped level even when storage throws', () => {
    installBrokenStorage()
    expect(writeMuteLevel(3)).toBe(3)
  })

  it('round-trips through storage', () => {
    installStorage()
    for (const level of LEVELS) {
      writeMuteLevel(level)
      expect(readMuteLevel()).toBe(level)
    }
  })
})
