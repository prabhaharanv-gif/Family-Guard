// Message mute level: 0 = notifications on, 1 = sound off, 2 = fully muted.
// Stored in localStorage under `msg_mute_level` and mirrored to the native
// side (SharedPreferences) so push notifications respect it while the app is
// closed.
//
// Everything that touches the stored value goes through here: a corrupt or
// out-of-range entry used to leak straight into `MUTE_STATES[muteLevel]` on
// the Messages page and crash the whole app with
// "Cannot read properties of undefined".

export const MUTE_LEVEL_KEY = 'msg_mute_level'
export const MUTE_LEVELS = 3

export function clampMuteLevel(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(n)) return 0
  const i = Math.trunc(n)
  if (i < 0 || i >= MUTE_LEVELS) return 0
  return i
}

export function readMuteLevel() {
  try {
    const raw = localStorage.getItem(MUTE_LEVEL_KEY)
    const level = clampMuteLevel(raw)
    // Repair a corrupt entry so we don't re-parse garbage on every read
    if (raw !== null && String(level) !== raw) localStorage.setItem(MUTE_LEVEL_KEY, String(level))
    return level
  } catch {
    return 0
  }
}

export function writeMuteLevel(level) {
  const next = clampMuteLevel(level)
  try { localStorage.setItem(MUTE_LEVEL_KEY, String(next)) } catch {}
  return next
}
