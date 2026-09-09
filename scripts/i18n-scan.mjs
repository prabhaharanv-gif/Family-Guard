/**
 * i18n-scan
 *
 * Reports user-facing English still hardcoded in the components — text that
 * would stay English no matter what language the app is set to.
 *
 * It is a heuristic, not a compiler: it looks for capitalised multi-word text
 * in JSX text nodes, in the props that render as text (placeholder, title,
 * label, aria-label, message, confirmLabel, sub), and in dialog payloads.
 * Expect a few false positives from prose in comments — read the line, not the
 * count.
 *
 *   npm run i18n:scan
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// Files whose whole job is to hold translations. Scanning them just reports
// the English half of every properly translated string — the drift that
// actually matters there is caught by `npm run i18n:check` instead.
const CATALOGUES = /[\\/]i18n[\\/]|[\\/]policy\.js$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.jsx?$/.test(full) && !CATALOGUES.test(full)) out.push(full)
  }
  return out
}

// A word run that reads like a sentence: starts capitalised, at least two words
// or one long one, and not an identifier/CSS value.
const TEXT = /^[A-Z][A-Za-z]*(?:[ ,'’&!?.\-][A-Za-z0-9]+)+[.!?]?$/

const IGNORE_LINE = /^\s*(\/\/|\*|\/\*)|svg|viewBox|stroke|linearGradient|className=|import |export |console\.|supabase\.|postgres_changes|localStorage|Capacitor|@keyframes|font-family|Sora|sans-serif/
const IGNORE_TEXT = /^(true|false|null|undefined)$/

// Some English is deliberate — a value written to the database, an external
// brand, a word typed verbatim into a confirmation field. Mark it at the
// source rather than remembering it:
//
//   /* i18n-exempt:start */ ... /* i18n-exempt:end */   for a block
//   const x = 'Foo'  // i18n-exempt                     for one line
//
// A scanner that keeps reporting known-good strings is one people stop reading.
const EXEMPT_LINE = /i18n-exempt/
const EXEMPT_START = /i18n-exempt:start/
const EXEMPT_END = /i18n-exempt:end/

const findings = []
// Per file, so the exempt total stays auditable: a bare count invites someone
// to widen a block until the scan goes quiet.
const exempt = {}

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inExemptBlock = false
  let blockStart = 0
  lines.forEach((line, i) => {
    if (EXEMPT_START.test(line)) { inExemptBlock = true; blockStart = i + 1; return }
    if (EXEMPT_END.test(line)) {
      inExemptBlock = false
      ;(exempt[relative(ROOT, file)] ||= []).push(`${blockStart}-${i + 1}`)
      return
    }
    if (inExemptBlock) return
    if (EXEMPT_LINE.test(line)) { (exempt[relative(ROOT, file)] ||= []).push(`${i + 1}`); return }
    if (IGNORE_LINE.test(line)) return

    const hits = new Set()

    // >Some visible text<
    for (const m of line.matchAll(/>\s*([A-Z][^<>{}\n]{3,60}?)\s*</g)) hits.add(m[1].trim())
    // prop="Some text" / prop='Some text'
    for (const m of line.matchAll(/(?:placeholder|title|label|sub|aria-label|message|confirmLabel)\s*[:=]\s*['"]([^'"]{4,80})['"]/g)) hits.add(m[1].trim())

    for (const raw of hits) {
      const text = raw.replace(/\s+/g, ' ')
      if (IGNORE_TEXT.test(text)) continue
      if (!TEXT.test(text)) continue
      findings.push({ file: relative(ROOT, file), line: i + 1, text })
    }
  })
}

const byFile = {}
for (const f of findings) (byFile[f.file] ||= []).push(f)

const files = Object.keys(byFile).sort((a, b) => byFile[b].length - byFile[a].length)
for (const f of files) {
  console.log(`\n${f}  (${byFile[f].length})`)
  for (const hit of byFile[f]) console.log(`  ${hit.line}: ${hit.text}`)
}

console.log(`\n${findings.length} hardcoded string(s) in ${files.length} file(s).`)

const exemptFiles = Object.keys(exempt).sort()
if (exemptFiles.length) {
  console.log('\ni18n-exempt (deliberately English — check these still deserve it):')
  for (const f of exemptFiles) console.log(`  ${f}  lines ${exempt[f].join(', ')}`)
}
