import { describe, it, expect } from 'vitest'
import { ageGroup, cleanAge, normalizeBackground, summarize, arrange, describeMembers, MAX_MEMBERS } from './familyBackground'

describe('ageGroup', () => {
  it('sorts ages into the visual groups', () => {
    expect([0, 3].map(a => ageGroup(a, 'boy'))).toEqual(['baby', 'baby'])
    expect([4, 7].map(a => ageGroup(a, 'girl'))).toEqual(['youngChild', 'youngChild'])
    expect([8, 12].map(a => ageGroup(a, 'girl'))).toEqual(['child', 'child'])
    expect([13, 17].map(a => ageGroup(a, 'boy'))).toEqual(['teen', 'teen'])
    expect([18, 25].map(a => ageGroup(a, 'girl'))).toEqual(['youngAdult', 'youngAdult'])
    expect(ageGroup(26, 'father')).toBe('adult')
  })
  it('without an age, a child type is a child and an adult type an adult', () => {
    expect(ageGroup(null, 'girl')).toBe('child')
    expect(ageGroup('', 'mother')).toBe('adult')
  })
})

describe('cleanAge', () => {
  it('keeps whole ages 0-99 and drops the rest', () => {
    expect(cleanAge('42')).toBe(42)
    expect(cleanAge(0)).toBe(0)
    expect(cleanAge('')).toBeNull()
    expect(cleanAge(150)).toBeNull()
    expect(cleanAge('x')).toBeNull()
    expect(cleanAge(7.5)).toBeNull()
  })
})

describe('normalizeBackground', () => {
  it('returns null for nothing usable', () => {
    expect(normalizeBackground(null)).toBeNull()
    expect(normalizeBackground({ scene: 'park', members: [] })).toBeNull()
    expect(normalizeBackground({ scene: 'park', members: [{ type: 'dog', age: 3 }] })).toBeNull()
  })
  it('falls back to the first scene and caps the number of people', () => {
    const many = Array.from({ length: 20 }, () => ({ type: 'boy', age: 5 }))
    const b = normalizeBackground({ scene: 'moon', members: many })
    expect(b.scene).toBe('sunset')
    expect(b.members).toHaveLength(MAX_MEMBERS)
  })
})

describe('the example family', () => {
  const family = [
    { type: 'father', age: 42 }, { type: 'mother', age: 38 },
    { type: 'girl', age: 18 }, { type: 'girl', age: 10 }, { type: 'boy', age: 7 },
  ]
  it('is counted from the data', () => {
    const s = summarize(family)
    expect(s).toMatchObject({ size: 5, adults: 3, children: 2, males: 2, females: 3 })
    expect(s.groups).toEqual(['adult', 'adult', 'youngAdult', 'child', 'youngChild'])
  })
  it('draws the sisters at different heights, the boy smaller still', () => {
    const [, , older, younger, boy] = describeMembers(family)
    expect(older.height).toBeGreaterThan(younger.height)
    expect(younger.height).toBeGreaterThan(boy.height)
  })
  it('puts the parents at the ends with the children between them, tallest first', () => {
    const order = arrange(family).map(p => p.type + p.age)
    expect(order[0]).toBe('father42')
    expect(order[order.length - 1]).toBe('mother38')
    expect(order.slice(1, 4)).toEqual(['girl18', 'girl10', 'boy7'])
  })
  it('keeps a young father and mother at the outer positions, only their looks follow their age', () => {
    const young = [{ type: 'father', age: 25 }, { type: 'mother', age: 24 }, { type: 'boy', age: 3 }, { type: 'girl', age: 1 }]
    const order = arrange(young).map(p => p.type)
    expect(order[0]).toBe('father')
    expect(order[order.length - 1]).toBe('mother')
    const [father, mother] = describeMembers(young)
    expect(father.group).toBe('youngAdult')
    expect(mother.group).toBe('youngAdult')
    expect(father.height).toBeLessThan(1)
  })
  it('looks different from a mother with one small son', () => {
    expect(summarize([{ type: 'mother', age: 36 }, { type: 'boy', age: 5 }])).toMatchObject({ size: 2, adults: 1, children: 1 })
  })
})
