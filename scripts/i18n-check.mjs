/**
 * i18n-check
 *
 * Lists every key English has that another language does not, and every key a
 * language has that English no longer does.
 *
 * This exists because the translation drift is silent: translate() falls back
 * to English per-key, so a missing Tamil string looks like a working screen
 * rather than a bug. Run it before a release.
 *
 *   npm run i18n:check
 */

import { UI } from '../src/i18n/ui.js'
import { getPolicy, SECTION_META } from '../src/lib/policy.js'

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

process.exit(problems ? 1 : 0)
