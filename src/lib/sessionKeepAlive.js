import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Keeps the Supabase session alive across app suspend/resume.
 *
 * Why this exists
 * ---------------
 * A Supabase access token expires after 1 hour. The client renews it from a
 * `setInterval` ticker that runs every 30s, and it only starts that ticker
 * while `document.visibilityState === 'visible'`.
 *
 * Neither half of that holds in an Android WebView. When the Activity is
 * paused (screen off, app backgrounded) the WebView freezes JS timers, so the
 * ticker stops. And Android does not reliably fire `visibilitychange` on the
 * document when the Activity is paused/resumed, so the client's own recovery
 * path — which is what would refresh an expired token on the way back in —
 * often never runs. The token quietly passes its expiry, every request starts
 * coming back 401, and the app looks logged out. The ~1-2 hour window users
 * see is just the token lifetime plus however long the app stayed open.
 *
 * The fix is to drive it from the platform lifecycle instead of the document:
 *   · resumed  → restart the ticker AND force a refresh right now, because the
 *                token may already be past expiry
 *   · paused   → stop the ticker; it cannot run reliably anyway
 *
 * Note this only ever *refreshes*. It never signs anyone out — a refresh that
 * fails while offline leaves the stored session untouched, and the next resume
 * tries again.
 */

let initialised = false

// Refresh when the token has less than this long left (or is already expired).
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Refresh the access token if it is expired or close to it.
 * Safe to call as often as you like — it no-ops when the token is healthy.
 */
export async function ensureFreshSession(reason = 'unknown') {
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
      console.warn(`[session] getSession failed (${reason}):`, error.message)
      return null
    }
    if (!session) return null

    const expiresAt = (session.expires_at ?? 0) * 1000
    const msLeft    = expiresAt - Date.now()

    if (msLeft > REFRESH_THRESHOLD_MS) return session

    const { data, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      // Offline or a transient server error. The stored session is left alone
      // on purpose so the next resume can retry — do NOT sign the user out.
      console.warn(`[session] refresh failed (${reason}):`, refreshError.message)
      return session
    }

    console.log(`[session] token refreshed (${reason})`)
    return data.session
  } catch (e) {
    console.warn(`[session] refresh threw (${reason}):`, e?.message)
    return null
  }
}

/**
 * Wire the session refresh to the app lifecycle. Call once, at startup.
 */
export function initSessionKeepAlive() {
  if (initialised) return
  initialised = true

  // ── Native (Capacitor) ──
  // appStateChange is the only signal that reliably fires when the Android
  // Activity is paused and resumed.
  if (Capacitor.isNativePlatform()) {
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        await ensureFreshSession('app-resumed')
        // Restart the library's own ticker — it was frozen while backgrounded.
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    })

    // Cold start / returning from a killed process.
    App.addListener('resume', () => { ensureFreshSession('app-resume-event') })
  }

  // ── Web / PWA ──
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') ensureFreshSession('tab-visible')
    })
  }

  // ── Belt and braces ──
  // A foreground timer that checks every 5 minutes. On native this is frozen
  // while backgrounded (which is fine — appStateChange covers that case), but
  // it catches the app being left open and idle for hours, where the WebView
  // may throttle the library's 30s ticker without pausing the Activity.
  setInterval(() => { ensureFreshSession('periodic') }, 5 * 60 * 1000)

  // And once immediately, for the case where the app was launched from cold
  // with a session that expired while it was closed.
  ensureFreshSession('startup')
}
