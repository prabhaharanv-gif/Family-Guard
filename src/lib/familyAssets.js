/**
 * Image assets for the Family Background: scene backdrops and character figures.
 *
 * Drop files into src/assets/family/ and they are picked up by name, with no code
 * change (see the README there for the exact names and sizes):
 *
 *   scenes/<scene>.webp          backdrop for a scene (sunset, home, garden, park)
 *   scenes/<scene>-front.webp    optional layer drawn in FRONT of the people
 *   people/<role>-<size>.webp    one character: man, woman, boy, girl + an age size
 *   people/baby.webp             a baby or toddler
 *   people/<name>-2.webp, -3     optional extra looks for the same character; people of
 *                                the same kind in one family take them in turn
 *
 * Anything missing falls back: a missing character is drawn with the built-in vector
 * figure and a missing backdrop with the built-in vector scene, so the page is never
 * blank or broken, whichever files exist.
 */
import { ageGroup, isFemaleType } from './familyBackground'

// Vite turns every matching file into a URL at build time. No such files yet: empty.
const FILES = import.meta.glob('../assets/family/**/*.{webp,png}', { eager: true, query: '?url', import: 'default' })

/** Age sizes in the file names, smallest to largest, with the age group each stands for. */
export const SIZES = ['small', 'child', 'teen', 'young', 'adult']
const GROUP_TO_SIZE = { youngChild: 'small', child: 'child', teen: 'teen', youngAdult: 'young', adult: 'adult' }

/** Where the people's feet are on each scene's backdrop, as a share of its height (0 top - 1 bottom). */
export const SCENE_FEET = { sunset: 0.84, home: 0.84, garden: 0.84, park: 0.84 }
export const DEFAULT_FEET = 0.84

/** { 'scenes/sunset': url, 'people/girl-child': url, 'people/girl-child-2': url, ... } */
export function buildCatalog(files) {
  const out = {}
  for (const [path, url] of Object.entries(files || {})) {
    const m = /family\/((?:scenes|people)\/[^/]+)\.(?:webp|png)$/i.exec(path)
    if (m) out[m[1]] = url
  }
  return out
}

const CATALOG = buildCatalog(FILES)

/** The role a person is drawn as. A grown son or daughter is drawn as a man or woman. */
export function roleOf(person) {
  const group = ageGroup(person.age, person.type)
  const adultLook = group === 'adult' || group === 'youngAdult'
  const female = isFemaleType(person.type)
  if (person.type === 'boy' || person.type === 'girl') {
    if (group === 'baby') return 'baby'
    return adultLook ? (female ? 'woman' : 'man') : (female ? 'girl' : 'boy')
  }
  return female ? 'woman' : 'man'
}

/** The file-name stem for a person, e.g. 'girl-child', 'man-adult' or 'baby'. */
export function characterKey(person) {
  const role = roleOf(person)
  if (role === 'baby') return 'baby'
  const group = ageGroup(person.age, person.type)
  // A grown-up of either kind is at least 'young'; a man or woman is never 'small'.
  let size = GROUP_TO_SIZE[group] || 'adult'
  if ((role === 'man' || role === 'woman') && (size === 'small' || size === 'child' || size === 'teen')) size = 'young'
  return `${role}-${size}`
}

/** The variants held for a stem: ['x', 'x-2', 'x-3'...] as catalog keys, in order. */
function variantsOf(catalog, stem) {
  const keys = []
  if (catalog[`people/${stem}`]) keys.push(`people/${stem}`)
  for (let n = 2; catalog[`people/${stem}-${n}`]; n++) keys.push(`people/${stem}-${n}`)
  return keys
}

/**
 * The image for a person, or null when no suitable file exists (the caller then draws the
 * vector figure). Tries the exact character first; failing that the nearest age size of
 * the same role, then the same side of the family (boy/man, girl/woman).
 * `turn` picks among extra looks, so two daughters of one age need not be identical.
 */
export function characterAsset(person, turn = 0, catalog = CATALOG) {
  const key = characterKey(person)
  const pick = stem => {
    const v = variantsOf(catalog, stem)
    return v.length ? catalog[v[turn % v.length]] : null
  }
  const exact = pick(key)
  if (exact) return exact
  if (key === 'baby') {
    return pick('boy-small') || pick('girl-small') || null
  }
  const [role, size] = key.split('-')
  const female = role === 'girl' || role === 'woman'
  const roles = female ? ['girl', 'woman'] : ['boy', 'man']
  const want = SIZES.indexOf(size)
  // every held stem of this side of the family, nearest age size first
  const held = []
  for (const r of roles) for (const s of SIZES) if (variantsOf(catalog, `${r}-${s}`).length) held.push(`${r}-${s}`)
  held.sort((a, b) => Math.abs(SIZES.indexOf(a.split('-')[1]) - want) - Math.abs(SIZES.indexOf(b.split('-')[1]) - want))
  return held.length ? pick(held[0]) : null
}

/** The backdrop ('back') or the optional front layer ('front') of a scene, or null. */
export function sceneAsset(scene, layer = 'back', catalog = CATALOG) {
  return catalog[layer === 'front' ? `scenes/${scene}-front` : `scenes/${scene}`] || null
}

export const feetFor = scene => SCENE_FEET[scene] ?? DEFAULT_FEET
