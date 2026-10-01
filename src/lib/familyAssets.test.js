import { describe, it, expect } from 'vitest'
import { buildCatalog, characterKey, characterAsset, sceneAsset, roleOf } from './familyAssets'

const cat = files => buildCatalog(Object.fromEntries(files.map(f => [`../assets/family/${f}.webp`, `/u/${f}`])))

describe('characterKey', () => {
  it('names each person by role and age size', () => {
    expect(characterKey({ type: 'father', age: 42 })).toBe('man-adult')
    expect(characterKey({ type: 'mother', age: 38 })).toBe('woman-adult')
    expect(characterKey({ type: 'girl', age: 18 })).toBe('woman-young')
    expect(characterKey({ type: 'girl', age: 15 })).toBe('girl-teen')
    expect(characterKey({ type: 'girl', age: 10 })).toBe('girl-child')
    expect(characterKey({ type: 'boy', age: 7 })).toBe('boy-small')
    expect(characterKey({ type: 'boy', age: 2 })).toBe('baby')
    expect(characterKey({ type: 'adultMale', age: null })).toBe('man-adult')
    expect(characterKey({ type: 'boy', age: 20 })).toBe('man-young')
  })
  it('a grown son is drawn as a man', () => expect(roleOf({ type: 'boy', age: 30 })).toBe('man'))
})

describe('characterAsset', () => {
  it('is null when there are no files, so the vector figure is used', () => {
    expect(characterAsset({ type: 'boy', age: 7 }, 0, {})).toBeNull()
  })
  it('uses the exact character when it exists', () => {
    const c = cat(['people/girl-child', 'people/girl-teen'])
    expect(characterAsset({ type: 'girl', age: 10 }, 0, c)).toBe('/u/people/girl-child')
  })
  it('falls back to the nearest age size of the same side of the family', () => {
    const c = cat(['people/girl-child', 'people/woman-adult', 'people/boy-child'])
    expect(characterAsset({ type: 'girl', age: 15 }, 0, c)).toBe('/u/people/girl-child')
    expect(characterAsset({ type: 'mother', age: 36 }, 0, c)).toBe('/u/people/woman-adult')
    // a man with no man file is not given a woman's picture
    expect(characterAsset({ type: 'father', age: 40 }, 0, c)).toBe('/u/people/boy-child')
  })
  it('takes extra looks in turn', () => {
    const c = cat(['people/girl-child', 'people/girl-child-2'])
    const g = { type: 'girl', age: 9 }
    expect([0, 1, 2].map(t => characterAsset(g, t, c))).toEqual(['/u/people/girl-child', '/u/people/girl-child-2', '/u/people/girl-child'])
  })
  it('a baby uses the baby file, else a small child of either kind', () => {
    expect(characterAsset({ type: 'girl', age: 1 }, 0, cat(['people/baby']))).toBe('/u/people/baby')
    expect(characterAsset({ type: 'girl', age: 1 }, 0, cat(['people/boy-small']))).toBe('/u/people/boy-small')
  })
})

describe('sceneAsset', () => {
  it('finds the backdrop and the optional front layer', () => {
    const c = cat(['scenes/park', 'scenes/park-front'])
    expect(sceneAsset('park', 'back', c)).toBe('/u/scenes/park')
    expect(sceneAsset('park', 'front', c)).toBe('/u/scenes/park-front')
    expect(sceneAsset('home', 'back', c)).toBeNull()
  })
})

describe('young parents', () => {
  it('are drawn by age: a father of 25 uses the young-man character', () => {
    expect(characterKey({ type: 'father', age: 25 })).toBe('man-young')
    expect(characterKey({ type: 'mother', age: 24 })).toBe('woman-young')
  })
})
