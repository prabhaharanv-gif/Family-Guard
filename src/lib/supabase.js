import { createClient } from '@supabase/supabase-js'

// ── API key resolution ──────────────────────────────────────────────────────
// Supabase replaced the old JWT-based keys (anon / service_role) with new
// format keys (sb_publishable_… / sb_secret_…). Once "Legacy API keys" are
// disabled in the dashboard (Settings → API Keys), every request made with the
// old anon JWT is rejected with: "Legacy API keys are disabled".
//
// Prefer the new publishable key, fall back to the legacy anon key so existing
// builds keep working until the key is swapped over.
const pick = (...vals) => vals.map(v => (v || '').trim()).find(Boolean) || ''

export const SUPABASE_URL = pick(import.meta.env.VITE_SUPABASE_URL)

export const SUPABASE_KEY = pick(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

/** True when the configured key is an old JWT-style key (anon / service_role). */
export const isLegacyApiKey =
  SUPABASE_KEY.startsWith('eyJ') && SUPABASE_KEY.split('.').length === 3

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[supabase] Missing config. Set VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY in .env, then rebuild.'
  )
} else if (isLegacyApiKey) {
  console.warn(
    '[supabase] Using a legacy (JWT) anon key. If this project has legacy API ' +
    'keys disabled, sign-in and registration will fail with "Legacy API keys ' +
    'are disabled". Copy the publishable key (sb_publishable_…) from ' +
    'Supabase → Settings → API Keys into VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

/**
 * Turns a Supabase error into something a user can act on. Key/config problems
 * otherwise surface as raw API text in the middle of a sign-up form.
 */
export function describeSupabaseError(err) {
  const msg = err?.message || String(err || 'Something went wrong')

  if (/legacy api keys? (are|is) disabled/i.test(msg)) {
    return 'The app is using an outdated Supabase API key. Update ' +
           'VITE_SUPABASE_PUBLISHABLE_KEY with the new publishable key and rebuild.'
  }
  if (/invalid api key|no api key/i.test(msg)) {
    return 'The app\'s Supabase API key is invalid. Check the key in .env and rebuild.'
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return 'Cannot reach the server. Check your internet connection and try again.'
  }
  return msg
}

/** True for errors caused by app configuration rather than user input. */
export function isConfigError(err) {
  const msg = err?.message || ''
  return /legacy api keys? (are|is) disabled|invalid api key|no api key/i.test(msg)
}
