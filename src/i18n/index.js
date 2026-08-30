/**
 * i18n core
 *
 * One language setting for the whole app — the UI strings here and the user
 * guide in manual.js both read it, so the app cannot end up half in Tamil and
 * half in English after someone switches language in one place.
 *
 * Zustand rather than React context because language is also needed outside
 * the tree (notification bodies built in hooks, alert() strings in lib code),
 * and a store can be read there with useLangStore.getState().
 */

import { create } from 'zustand'
import { UI } from './ui'

// Languages the *interface* is translated into. The user guide ships in more
// (see LANGUAGES in manual.js) — a guide someone reads once is cheap to
// translate, every screen in the app is not. Keep these separate so adding a
// guide language does not silently claim the UI is translated too.
export const UI_LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'ta', native: 'தமிழ்' },
  { code: 'hi', native: 'हिन्दी' },
]

const LANG_KEY = 'famora_lang'

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && UI[saved]) return saved
    // No explicit choice yet: follow the device. navigator.language is
    // "ta-IN" on a Tamil phone, so match on the prefix.
    const device = (navigator.language || '').slice(0, 2).toLowerCase()
    if (UI[device]) return device
  } catch (e) {}
  return 'en'
}

export const useLangStore = create((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    if (!UI[lang]) return
    try { localStorage.setItem(LANG_KEY, lang) } catch (e) {}
    // <html lang> so the OS/webview picks font fallbacks for the right script
    // and screen readers switch voice.
    try { document.documentElement.lang = lang } catch (e) {}
    set({ lang })
  },
}))

// Set on load too, not just on change — otherwise a Tamil-by-default start
// renders Tamil text under lang="en".
try { document.documentElement.lang = useLangStore.getState().lang } catch (e) {}

function lookup(table, key) {
  // Dotted keys ('nav.family') walk the nested catalog.
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), table)
}

/**
 * Translate a key, falling back to English per-key rather than per-language —
 * a missing Tamil string shows the English one instead of blanking the screen.
 * `vars` fills {placeholders}; values are inserted as text, never parsed.
 */
export function translate(lang, key, vars) {
  let s = lookup(UI[lang], key)
  if (s === undefined) s = lookup(UI.en, key)
  if (s === undefined) {
    // Loud in dev, harmless in production: showing the key beats showing
    // nothing, and it makes an untranslated string obvious in a screenshot.
    if (import.meta.env?.DEV) console.warn('[i18n] missing key:', key)
    return key
  }
  if (typeof s === 'function') return s(vars || {})
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(vars[k])
  }
  return s
}

/** Hook form — re-renders the component when the language changes. */
export function useT() {
  const lang = useLangStore((s) => s.lang)
  const t = (key, vars) => translate(lang, key, vars)
  t.lang = lang
  return t
}

/** Non-React callers (hooks building notification text, lib helpers). */
export function t(key, vars) {
  return translate(useLangStore.getState().lang, key, vars)
}
