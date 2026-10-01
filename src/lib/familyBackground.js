/**
 * Family background: the picture behind the Family page, drawn from a family description.
 * Only type/age are used for the illustration; names and real member accounts are not needed.
 */

export const MEMBER_TYPES = ['father', 'mother', 'adultMale', 'adultFemale', 'boy', 'girl']
export const SCENES = ['sunset', 'home', 'garden', 'park']
export const MAX_MEMBERS = 10

const ADULT_TYPES = new Set(['father', 'mother', 'adultMale', 'adultFemale'])
const FEMALE_TYPES = new Set(['mother', 'adultFemale', 'girl'])

export const isAdultType = type => ADULT_TYPES.has(type)
export const isFemaleType = type => FEMALE_TYPES.has(type)

export function cleanAge(age) {
  if (age === '' || age == null) return null
  const n = Number(age)
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null
}

export function ageGroup(age, type) {
  const n = cleanAge(age)
  if (n == null) return isAdultType(type) ? 'adult' : 'child'
  if (n <= 3) return 'baby'
  if (n <= 7) return 'youngChild'
  if (n <= 12) return 'child'
  if (n <= 17) return 'teen'
  if (n <= 25) return 'youngAdult'
  return 'adult'
}

const GROUP_HEIGHT = {
  baby: 0.34,
  youngChild: 0.52,
  child: 0.66,
  teen: 0.86,
  youngAdult: 0.94,
  adult: 1,
}

export function heightFactor(type, age) {
  const g = ageGroup(age, type)
  let h = GROUP_HEIGHT[g]
  if (isFemaleType(type) && (g === 'adult' || g === 'youngAdult')) h *= 0.95
  return h
}

export function cleanMembers(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(m => m && MEMBER_TYPES.includes(m.type))
    .slice(0, MAX_MEMBERS)
    .map(m => ({ type: m.type, age: cleanAge(m.age) }))
}

export function normalizeBackground(raw) {
  if (!raw || typeof raw !== 'object') return null
  const members = cleanMembers(raw.members)
  if (!members.length) return null
  return {
    scene: SCENES.includes(raw.scene) ? raw.scene : SCENES[0],
    members,
  }
}

export function describeMembers(members) {
  return cleanMembers(members).map(m => {
    const group = ageGroup(m.age, m.type)
    return {
      ...m,
      group,
      female: isFemaleType(m.type),
      adult: group === 'adult' || group === 'youngAdult',
      height: heightFactor(m.type, m.age),
    }
  })
}

export function summarize(members) {
  const people = describeMembers(members)
  const adults = people.filter(p => p.adult)
  const kids = people.filter(p => !p.adult)
  return {
    size: people.length,
    adults: adults.length,
    children: kids.length,
    males: people.filter(p => !p.female).length,
    females: people.filter(p => p.female).length,
    groups: people.map(p => p.group),
  }
}

/**
 * Parents/adults are kept toward the outside and children toward the middle.
 * Within each side, taller people remain visually dominant.
 */
export function arrange(members) {
  const people = describeMembers(members).map((p, i) => ({ ...p, i }))
  if (people.length <= 2) return people.sort((a, b) => b.height - a.height || a.i - b.i)

  // A father or mother is a parent whatever their age (age only changes how they look);
  // anyone else counts as one from 26 up.
  const isParent = p => p.type === 'father' || p.type === 'mother' || p.group === 'adult'
  const adults = people.filter(isParent).sort((a,b) => b.height-a.height || a.i-b.i)
  const kids = people.filter(p => !isParent(p)).sort((a,b) => b.height-a.height || a.i-b.i)

  const left = adults.filter((_,i) => i % 2 === 0)
  const right = adults.filter((_,i) => i % 2 === 1)

  // Two adults: one parent on each side. Extra adults flank the children.
  const ordered = []
  if (left[0]) ordered.push(left[0])
  ordered.push(...kids)
  if (right[0]) ordered.push(right[0])

  // Any remaining adults are inserted at the outer edges.
  for (let i = 1; i < left.length; i++) ordered.unshift(left[i])
  for (let i = 1; i < right.length; i++) ordered.push(right[i])

  return ordered
}
