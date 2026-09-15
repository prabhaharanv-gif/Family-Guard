import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { LocationService } from './locationPlugin'
import { createBrokeredFetch } from './refreshBroker'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Session storage that cannot silently lose the session.
 *
 * The Supabase client keeps the session (access token + refresh token) in
 * localStorage. Inside an Android WebView a localStorage read/write can throw
 * or come back empty — quota pressure, WebView storage eviction, or the app
 * being restored into a fresh WebView. If the read throws, the client sees "no
 * session" and the user lands back on the login screen.
 *
 * So: mirror every write in memory and fall back to the mirror whenever
 * localStorage misbehaves. Worst case the session survives until the process
 * is killed, instead of the user being logged out mid-session.
 */
const memoryStore = new Map()

const resilientStorage = {
  getItem: (key) => {
    try {
      const value = globalThis.localStorage?.getItem(key)
      if (value !== null && value !== undefined) {
        memoryStore.set(key, value)
        return value
      }
    } catch (e) {
      console.warn('[supabase] localStorage read failed, using memory mirror:', e?.message)
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null
  },
  setItem: (key, value) => {
    memoryStore.set(key, value)
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch (e) {
      console.warn('[supabase] localStorage write failed, kept in memory only:', e?.message)
    }
  },
  removeItem: (key) => {
    memoryStore.delete(key)
    try {
      globalThis.localStorage?.removeItem(key)
    } catch (e) {
      console.warn('[supabase] localStorage remove failed:', e?.message)
    }
  },
}

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    // On Android every token refresh goes through the native TokenBroker, the
    // same lock the location service and SOS sender use. Without it both sides
    // spent the single-use refresh token and Supabase revoked the session — the
    // "logged out by itself" bug. See lib/refreshBroker.js.
    global: {
      fetch: createBrokeredFetch({
        isNative: () => Capacitor.isNativePlatform(),
        redeem: (refreshToken) => LocationService.redeemRefreshToken({
          refreshToken,
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_KEY,
        }),
      }),
    },
    auth: {
      // Keep the session across app restarts and refresh the access token
      // before it expires. These are the library defaults, but they are load
      // bearing here, so they are stated explicitly.
      persistSession:   true,
      autoRefreshToken: true,

      // The app is served from a fixed localhost URL inside the WebView and
      // never receives auth tokens in the URL. Leaving detection on makes the
      // client parse every navigation looking for tokens, which is pure risk
      // with no upside on native.
      detectSessionInUrl: false,

      // NOTE: the default storageKey is kept deliberately. Changing it would
      // point the client at an empty slot and sign out every user already
      // logged in, which is the exact thing this file is here to prevent.
      storage: resilientStorage,
    },
  }
)
