/**
 * Auth diagnostics ring buffer.
 *
 * The logout we are chasing happens while the app is backgrounded, often
 * hours in, and a plain console.log is gone by the time anyone looks. So every
 * auth-relevant moment is appended to a small ring buffer in localStorage that
 * survives backgrounding, WebView reloads and app restarts.
 *
 * Read it from a connected debugger (chrome://inspect) with:
 *     __authLog()        pretty-printed timeline
 *     __authLogRaw()     the raw array
 *     __authLogClear()   wipe it
 *
 * NEVER records tokens. Only event names, timestamps and expiry maths.
 */

const KEY = 'famora-auth-debug'
const MAX_ENTRIES = 200

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function write(entries) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // Storage full or unavailable — diagnostics are best effort, never fatal.
  }
}

/**
 * @param {string} what  short event name, e.g. 'app-resumed' or 'SIGNED_OUT'
 * @param {object} [details]  small, token-free extras
 */
export function authLog(what, details = {}) {
  const entry = {
    t: new Date().toISOString(),
    what,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    ...details,
  }
  const entries = read()
  entries.push(entry)
  write(entries)
  console.log(`[auth] ${what}`, details)
}

/** Summarise a session without ever touching the tokens. */
export function describeSession(session) {
  if (!session) return { hasSession: false }
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  return {
    hasSession: true,
    userId: session.user?.id?.slice(0, 8),   // first octet only, for correlation
    expiresAt: new Date(expiresAtMs).toISOString(),
    minsLeft: Math.round((expiresAtMs - Date.now()) / 60000),
  }
}

if (typeof window !== 'undefined') {
  window.__authLogRaw = () => read()
  window.__authLogClear = () => { write([]); return 'cleared' }
  window.__authLog = () => {
    const entries = read()
    if (!entries.length) return 'no auth events recorded yet'
    return entries.map(e => {
      const { t, what, ...rest } = e
      return `${t}  ${what.padEnd(22)} ${JSON.stringify(rest)}`
    }).join('\n')
  }
}
