import { describe, it, expect } from 'vitest'
import { UI } from './ui'

// FamilyPage's FittedLine splits these sentences around {when} so the time is
// never cut off by the ellipsis. That only works if every language has the
// placeholder exactly once.
describe('Family card status lines', () => {
  for (const lang of Object.keys(UI)) {
    for (const key of ['lastSeen', 'joined']) {
      it(`${lang} family.${key} has {when} exactly once`, () => {
        const s = UI[lang].family[key]
        expect(typeof s).toBe('string')
        expect(s.split('{when}').length).toBe(2)
      })
    }
  }
})
