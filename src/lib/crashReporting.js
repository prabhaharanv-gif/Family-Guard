/**
 * crashReporting.js
 *
 * Capacitor bridge to the native Android CrashReporting plugin (Crashlytics).
 *
 * Native crashes and ANRs are collected by the SDK on their own. This file
 * exists for the errors it cannot see: anything that goes wrong inside the
 * WebView. A React render that throws leaves the process perfectly healthy, so
 * without an explicit report the user gets a broken screen and we hear nothing.
 *
 * Every call is best-effort and swallows its own failure — crash reporting must
 * never be the reason something breaks.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const CrashReporting = registerPlugin('CrashReporting')

const isNative = () => Capacitor.isNativePlatform()

/** Breadcrumb attached to the next report. */
export async function logBreadcrumb(message) {
  if (!isNative() || !message) return
  try { await CrashReporting.log({ message: String(message) }) } catch { /* never throw from reporting */ }
}

/** Report a non-fatal error. `context` says where it came from. */
export async function recordError(error, context = '') {
  if (!isNative()) return
  try {
    await CrashReporting.recordError({
      message: String(error?.message || error || 'Unknown error'),
      stack:   String(error?.stack || ''),
      context: String(context || ''),
    })
  } catch { /* never throw from reporting */ }
}

/** Opaque Supabase UUID, so a crash can be tied to a support report. */
export async function setCrashUserId(userId) {
  if (!isNative()) return
  try { await CrashReporting.setUserId({ userId: userId || '' }) } catch { /* ignore */ }
}

/** Consent switch — persists across launches, so only call it on change. */
export async function setCrashReportingEnabled(enabled) {
  if (!isNative()) return
  try { await CrashReporting.setEnabled({ enabled: !!enabled }) } catch { /* ignore */ }
}

/**
 * Catch what never reaches an ErrorBoundary: errors thrown outside React's
 * render tree (event handlers, timers, native bridge callbacks) and rejected
 * promises with no .catch — which is most of how this app talks to Supabase.
 */
export function initCrashReporting() {
  if (!isNative() || typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    recordError(event.error || new Error(event.message), 'window.onerror')
  })

  window.addEventListener('unhandledrejection', (event) => {
    recordError(event.reason, 'unhandledrejection')
  })
}
