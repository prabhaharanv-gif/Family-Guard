/**
 * i18n-check
 *
 * Lists every key English has that another language does not, and every key a
 * language has that English no longer does.
 *
 * Three catalogues, three shapes: the flat UI keys, the privacy policy and the
 * user guide. The last two are not key catalogues — what matters there is that
 * no SECTION quietly falls back to English, because both fall back per section
 * rather than per string.
 *
 * This exists because the translation drift is silent: translate() falls back
 * to English per-key, so a missing Tamil string looks like a working screen
 * rather than a bug. Run it before a release.
 *
 *   npm run i18n:check
 */

import { UI } from '../src/i18n/ui.js'
import { getPolicy, SECTION_META } from '../src/lib/policy.js'
import { MANUAL, SECTION_META as MANUAL_META } from '../src/i18n/manual.js'

function flatten(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, key))
    else out.push(key)
  }
  return out
}

const enKeys = flatten(UI.en)
let problems = 0

for (const lang of Object.keys(UI)) {
  if (lang === 'en') continue
  const keys = new Set(flatten(UI[lang]))
  const missing = enKeys.filter(k => !keys.has(k))
  const extra = [...keys].filter(k => !enKeys.includes(k))

  const pct = Math.round(((enKeys.length - missing.length) / enKeys.length) * 100)
  console.log(`\n${lang}: ${enKeys.length - missing.length}/${enKeys.length} keys (${pct}%)`)

  if (missing.length) {
    problems += missing.length
    console.log(`  missing (${missing.length}) — these fall back to English:`)
    for (const k of missing) console.log(`    ${k}`)
  }
  if (extra.length) {
    problems += extra.length
    console.log(`  stale (${extra.length}) — not in English any more, safe to delete:`)
    for (const k of extra) console.log(`    ${k}`)
  }
  if (!missing.length && !extra.length) console.log('  in sync with English')
}

console.log(`\nEnglish keys: ${enKeys.length}`)

// ── Privacy policy ─────────────────────────────────────────────────────────
// Checked separately because it is not a flat key catalogue: what matters is
// that every section is present and that no section silently falls back to
// English, since a missing translation there is a missing disclosure.
console.log('\nprivacy policy')
const enPolicy = getPolicy('en')
for (const lang of Object.keys(UI)) {
  if (lang === 'en') continue
  const p = getPolicy(lang)

  const untranslated = p.sections.filter((s, i) => {
    const e = enPolicy.sections[i]
    return s.title === e.title || s.items.some((it, j) => it === e.items[j])
  })
  const countMismatch = p.sections.filter((s, i) => {
    return s.items.length !== enPolicy.sections[i].items.length
  })

  if (!untranslated.length && !countMismatch.length) {
    console.log(`  ${lang}: all ${SECTION_META.length} sections translated, item counts match`)
  }
  if (untranslated.length) {
    problems += untranslated.length
    console.log(`  ${lang}: falling back to English in — ${untranslated.map(s => s.key).join(', ')}`)
  }
  if (countMismatch.length) {
    problems += countMismatch.length
    console.log(`  ${lang}: DISCLOSURE COUNT DIFFERS from English in — ${countMismatch.map(s => s.key).join(', ')}`)
  }
}

// ── User guide ─────────────────────────────────────────────────────────────
// Same shape as the policy check, and the same reason: UserManualPage resolves
// per section (t.sections?.[key] || en.sections[key]), so a section nobody has
// translated renders in English inside an otherwise translated guide — it reads
// as an oversight in the copy rather than as anything broken.
//
// Two failures worth separating:
//   · a section missing, or still word-for-word English
//   · a section present but with fewer steps than English, which is what
//     happens when a feature is documented in English and not carried across
//
// The top-level fields are stricter than either. The page reads t.title and
// t.footer with no fallback at all, so a missing one renders blank rather than
// in English.
console.log('\nuser guide')
const enManual = MANUAL.en
const enFields = Object.keys(enManual).filter(k => k !== 'sections')

for (const lang of Object.keys(MANUAL)) {
  if (lang === 'en') continue
  const t = MANUAL[lang]

  const blank = enFields.filter(f => t[f] === undefined)
  const untranslated = []
  const countMismatch = []

  for (const { key } of MANUAL_META) {
    const e = enManual.sections[key]
    const s = t.sections?.[key]
    if (!s || !Array.isArray(s.steps)) { untranslated.push(key); continue }

    // Identical title, or any step whose body still reads as the English one.
    const sameAsEnglish = s.title === e.title ||
      s.steps.some((step, i) => e.steps[i] && step[1] === e.steps[i][1])
    if (sameAsEnglish) untranslated.push(key)
    if (s.steps.length !== e.steps.length) countMismatch.push(key)
  }

  if (!blank.length && !untranslated.length && !countMismatch.length) {
    console.log(`  ${lang}: all ${MANUAL_META.length} sections translated, step counts match`)
  }
  if (blank.length) {
    problems += blank.length
    console.log(`  ${lang}: RENDERS BLANK — no translation and no fallback for — ${blank.join(', ')}`)
  }
  if (untranslated.length) {
    problems += untranslated.length
    console.log(`  ${lang}: falling back to English in — ${untranslated.join(', ')}`)
  }
  if (countMismatch.length) {
    problems += countMismatch.length
    console.log(`  ${lang}: STEP COUNT DIFFERS from English in — ${countMismatch.join(', ')}`)
  }
}

process.exit(problems ? 1 : 0)
