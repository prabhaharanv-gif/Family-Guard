import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { authLog, describeSession } from './authDebug'
import { adoptNativeSession } from './nativeSession'

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

// Who is allowed to spend the refresh token right now.
//
// Supabase refresh tokens are single-use: redeeming one issues a replacement
// and revokes it. Two holders therefore cannot both refresh — whoever goes
// second is told "Invalid Refresh Token: Already Used", and supabase-js treats
// that as unrecoverable and erases the session.
//
// This app has exactly two holders: the WebView, and LocationForegroundService,
// which keeps its own copy in SharedPreferences so it can post locations with
// the app closed. So refreshing is split by lifecycle rather than shared:
//
//   foreground → JS owns it. Timers run, so the token never reaches expiry and
//                the service never sees a 401 to react to.
//   background → the service owns it. JS must not touch the token; on the way
//                back in it adopts whatever the service now holds.
//
// The comment that used to sit on the periodic timer assumed Android freezes
// JS timers while backgrounded, so no gate was needed. That is not true here:
// the foreground location service keeps the process alive, and the WebView
// keeps ticking with it. Traced on a Redmi (Android 12) — backgrounded at
// 13:19:26, the periodic refresh fired anyway at 13:20:55 and lost the race.
let appActive = true
let periodicTimer = null

function startPeriodic() {
  if (periodicTimer) return
  periodicTimer = setInterval(() => { ensureFreshSession('periodic') }, 5 * 60 * 1000)
}

function stopPeriodic() {
  if (!periodicTimer) return
  clearInterval(periodicTimer)
  periodicTimer = null
}

/**
 * Refresh the access token if it is expired or close to it.
 * Safe to call as often as you like — it no-ops when the token is healthy.
 */
export async function ensureFreshSession(reason = 'unknown') {
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
      authLog('getSession-failed', { reason, error: error.message })
      return null
    }
    if (!session) {
      authLog('no-session', { reason })
      return null
    }

    const expiresAt = (session.expires_at ?? 0) * 1000
    const msLeft    = expiresAt - Date.now()

    if (msLeft > REFRESH_THRESHOLD_MS) {
      authLog('token-healthy', { reason, ...describeSession(session) })
      return session
    }

    // Backgrounded: the service owns the token. Spending it here is what
    // revokes the copy the service is about to use — and vice versa. Report
    // the state and leave it alone; the resume path adopts what the service
    // ends up holding.
    if (!appActive) {
      authLog('refresh-deferred-background', { reason, ...describeSession(session) })
      return session
    }

    authLog('refresh-attempt', { reason, ...describeSession(session) })

    const { data, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      authLog('refresh-FAILED', { reason, error: refreshError.message, ...describeSession(session) })

      // A rejected refresh token usually means the background location service
      // renewed the session natively while the app was closed — Supabase
      // rotates on renewal, so our copy was revoked the moment the service got
      // its new one. The service holds the live token; take it and carry on.
      const adopted = await adoptNativeSession(`${reason}-after-refresh-failure`)
      if (adopted) {
        const { data: { session: fresh } } = await supabase.auth.getSession()
        authLog('recovered-from-native', { reason, ...describeSession(fresh) })
        return fresh
      }

      // Otherwise offline or a transient server error. Leave the stored
      // session alone so the next resume can retry — never sign the user out.
      return session
    }

    authLog('refresh-ok', { reason, ...describeSession(data.session) })
    return data.session
  } catch (e) {
    authLog('refresh-threw', { reason, error: e?.message })
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
      authLog(isActive ? 'app-foreground' : 'app-background')
      if (isActive) {
        // Order matters. Take ownership back only after adopting, so nothing
        // here can spend a token the service has already replaced.
        await adoptNativeSession('app-resumed')
        appActive = true
        await ensureFreshSession('app-resumed')
        // Restart the tickers — ours was stopped, and the library's is
        // unreliable while the Activity is paused.
        supabase.auth.startAutoRefresh()
        startPeriodic()
      } else {
        // Hand ownership to the service before stopping anything, so a timer
        // already in flight sees the flag and defers.
        appActive = false
        stopPeriodic()
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
  // A foreground timer that checks every 5 minutes, for the app being left
  // open and idle for hours, where the WebView may throttle the library's 30s
  // ticker without pausing the Activity.
  //
  // It is stopped on background rather than left to Android: this process
  // hosts a foreground service, so its timers keep running when the Activity
  // pauses, and a tick that lands while backgrounded spends a token the
  // location service is relying on.
  startPeriodic()

  // And once immediately, for the case where the app was launched from cold
  // with a session that expired while it was closed.
  ensureFreshSession('startup')
}
