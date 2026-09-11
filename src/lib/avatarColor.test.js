import { describe, it, expect } from 'vitest'
import { avatarColor, MAROON } from './avatarColor'

/**
 * Covers the colour behind an initial-letter avatar.
 *
 * `family_members.avatar_color` still defaults to the old blue in the database,
 * so every member created before the rebrand — and every member since who never
 * picked a colour — carries it. This function is what makes the whole app agree
 * that the legacy blue means "unset", instead of each screen re-deciding.
 */
describe('avatarColor', () => {
  const LEGACY_BLUE = '#4F8EF7'

  it('paints the legacy default as maroon', () => {
    expect(avatarColor(LEGACY_BLUE)).toBe(MAROON)
  })

  it('recognises the legacy default whatever its case', () => {
    expect(avatarColor('#4f8ef7')).toBe(MAROON)
    expect(avatarColor('#4F8EF7')).toBe(MAROON)
    expect(avatarColor('#4F8ef7')).toBe(MAROON)
  })

  it('keeps a colour the member actually chose', () => {
    expect(avatarColor('#123456')).toBe('#123456')
    expect(avatarColor('#FF0000')).toBe('#FF0000')
  })

  it('preserves the exact string of a chosen colour', () => {
    expect(avatarColor('#AbCdEf')).toBe('#AbCdEf')
  })

  it('falls back to maroon when no colour is stored', () => {
    expect(avatarColor(null)).toBe(MAROON)
    expect(avatarColor(undefined)).toBe(MAROON)
    expect(avatarColor('')).toBe(MAROON)
  })

  it('is stable — the same member keeps the same colour', () => {
    expect(avatarColor('#123456')).toBe(avatarColor('#123456'))
    expect(avatarColor(null)).toBe(avatarColor(null))
  })

  it('never returns nothing, so an avatar always has a background', () => {
    for (const input of [null, undefined, '', LEGACY_BLUE, '#000000']) {
      expect(avatarColor(input)).toBeTruthy()
    }
  })
})
