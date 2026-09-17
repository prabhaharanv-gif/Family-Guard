// Message mute level. Stored in localStorage under `msg_mute_level` and
// mirrored to the native side (SharedPreferences) so push notifications respect
// it while the app is closed. It covers family and personal messages only —
// SOS alerts and calls are never muted by it.
//
//   0  notifications on        sound + pop-up
//   1  sound & pop-up muted    a silent entry in the notification list
//   2  (retired) all off       read back as 1 — see below
//   3  sound muted             the pop-up still appears, silently
//   4  pop-up muted            the sound still plays, no pop-up
//
// The numbers are not in menu order because 0 and 1 are older than the menu:
// phones already store them, and the native side reads the same integers. 2
// used to drop the notification entirely. It was retired when the bell became
// a Sound / Pop-up / Sound & Pop-up menu (2026-09-16): once sound and pop-up
// are both off, a message notification has nothing left worth hiding. Anyone
// still holding it is moved to 1, the nearest remaining choice.
//
// Everything that touches the stored value goes through here: a corrupt or
// out-of-range entry used to leak straight into `MUTE_STATES[muteLevel]` on
// the Messages page and crash the whole app with
// "Cannot read properties of undefined".

export const MUTE_LEVEL_KEY = 'msg_mute_level'

export const MUTE = {
  NONE: 0,
  SOUND_AND_POPUP: 1,
  SOUND: 3,
  POPUP: 4,
}

const LEGACY_ALL_OFF = 2
const VALID = new Set(Object.values(MUTE))

export function clampMuteLevel(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(n)) return MUTE.NONE
  const i = Math.trunc(n)
  if (i === LEGACY_ALL_OFF) return MUTE.SOUND_AND_POPUP
  return VALID.has(i) ? i : MUTE.NONE
}

export function readMuteLevel() {
  try {
    const raw = localStorage.getItem(MUTE_LEVEL_KEY)
    const level = clampMuteLevel(raw)
    // Repair a corrupt or retired entry so it is not re-parsed on every read
    if (raw !== null && String(level) !== raw) localStorage.setItem(MUTE_LEVEL_KEY, String(level))
    return level
  } catch {
    return MUTE.NONE
  }
}

export function writeMuteLevel(level) {
  const next = clampMuteLevel(level)
  try { localStorage.setItem(MUTE_LEVEL_KEY, String(next)) } catch {}
  return next
}
