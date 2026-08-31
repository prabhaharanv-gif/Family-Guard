// Crash log — keeps the last few errors in localStorage so a failure on a
// phone can be read back from the app itself, without a debugger attached.
//
// The ErrorBoundary only sees errors thrown during render or in lifecycle
// methods. Failures inside async handlers (a Supabase call, a Capacitor
// plugin, a realtime callback) surface as unhandled rejections and would
// otherwise vanish silently, so those are captured here too.

const KEY = 'fg_crash_log'
const MAX = 5

export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

export function recordCrash(source, error, extra) {
  const entry = {
    at: new Date().toISOString(),
    build: BUILD_ID,
    source,
    path: typeof location !== 'undefined' ? location.pathname : '',
    message: error?.message || String(error ?? 'Unknown error'),
    stack: error?.stack?.split('\n').slice(0, 6).join('\n'),
    extra: extra || undefined,
  }
  try {
    const log = getCrashLog()
    log.unshift(entry)
    localStorage.setItem(KEY, JSON.stringify(log.slice(0, MAX)))
  } catch {}
  return entry
}

export function getCrashLog() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function clearCrashLog() {
  try { localStorage.removeItem(KEY) } catch {}
}

export function formatCrashLog() {
  return getCrashLog().map(e =>
    `${e.at} · ${e.source} · ${e.path}\n${e.message}${e.stack ? '\n' + e.stack : ''}`
  ).join('\n\n')
}

let installed = false
export function installGlobalCrashHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', e => {
    // Ignore resource load errors (no `error` object attached)
    if (!e.error) return
    recordCrash('window.error', e.error)
  })
  window.addEventListener('unhandledrejection', e => {
    recordCrash('unhandledrejection', e.reason instanceof Error ? e.reason : new Error(String(e.reason)))
  })
}
