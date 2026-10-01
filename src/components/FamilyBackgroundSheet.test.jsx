import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

let state = { background: null, save: async () => {} }
vi.mock('../hooks/useFamilyBackground', () => ({ useFamilyBackground: () => state }))
vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }))

const { default: FamilyBackgroundSheet } = await import('./FamilyBackgroundSheet')
const { default: FamilyScene } = await import('./FamilyScene')

describe('FamilyBackgroundSheet', () => {
  it('opens empty for a family with no background, offering every kind of member and the scenes', () => {
    state = { background: null, save: async () => {} }
    const html = renderToString(<FamilyBackgroundSheet familyId="f" onClose={() => {}} />)
    expect(html).toContain('Choose your family background')
    for (const w of ['Father', 'Mother', 'Adult man', 'Adult woman', 'Boy', 'Girl', 'Sunset', 'Home', 'Garden', 'Park']) expect(html).toContain(w)
    expect(html).not.toContain('Remove background')
  })

  it('opens with the saved family and offers to remove it', () => {
    state = { background: { scene: 'park', members: [{ type: 'mother', age: 36 }, { type: 'boy', age: 5 }] }, save: async () => {} }
    const html = renderToString(<FamilyBackgroundSheet familyId="f" onClose={() => {}} />)
    expect(html).toContain('value="36"')
    expect(html).toContain('value="5"')
    expect(html).toContain('Remove background')
  })
})

describe('FamilyScene', () => {
  it('draws one figure per person and still draws a scene for an empty family', () => {
    const five = renderToString(<FamilyScene scene="sunset" members={[{ type: 'father', age: 42 }, { type: 'mother', age: 38 }, { type: 'girl', age: 18 }, { type: 'girl', age: 10 }, { type: 'boy', age: 7 }]} />)
    expect(five.split('<g transform="translate').length - 1).toBe(5)
    expect(renderToString(<FamilyScene scene="nope" members={[]} />)).toContain('<svg')
  })
})
