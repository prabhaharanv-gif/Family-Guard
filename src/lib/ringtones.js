/**
 * ringtones.js
 *
 * Bridge to the native Ringtone plugin, which lets each of the four alerts —
 * message, SOS, voice call, video call — use its own sound.
 *
 * Choices live in native SharedPreferences rather than localStorage, because
 * the code that plays these sounds (MyFirebaseMessagingService, SOSSirenService,
 * CallRingingService) runs with no WebView attached and could not read them
 * otherwise.
 *
 * Every call is best-effort: an alert with no stored choice falls back to its
 * built-in default, so a failure here changes nothing about whether an alert
 * sounds.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const Ringtone = registerPlugin('Ringtone')

// `key` is the identity — it names the stored ringtone preference and the
// profile.sound.* / profile.soundHint.* translations the settings screen
// renders. The English text lives in the catalogue, not here.
export const ALERT_TYPES = [
  { key: 'message' },
  { key: 'sos' },
  { key: 'voice' },
  { key: 'video' },
]

/** Current selection titles, e.g. { message: 'Chime', sos: 'Default' }. */
export async function getRingtones() {
  if (!Capacitor.isNativePlatform()) return null
  try { return await Ringtone.getAll() } catch { return null }
}

/**
 * Open the system picker for one alert.
 * Resolves { changed, title } — changed is false if the user backed out.
 */
export async function pickRingtone(type) {
  if (!Capacitor.isNativePlatform()) return { changed: false }
  try {
    return await Ringtone.pick({ type })
  } catch (e) {
    // Reported rather than swallowed. A silent catch here is exactly why the
    // four buttons could sit dead for a whole release: the plugin was rejecting
    // every call ("Unknown alert type: null", because the caller passed
    // undefined) and nothing on screen or in the log ever said so.
    console.warn('[ringtones] pick failed:', e?.message || e)
    return { changed: false, error: e?.message || 'pick failed' }
  }
}

/**
 * Every sound of the right kind for one alert, for the app's own picker.
 * Resolves { items: [{ title, uri }], current } — current is the stored uri, or
 * null when the alert is on its default.
 *
 * The app draws this list itself because the system picker belongs to another
 * package and cannot be themed. pickRingtone() above stays available as the
 * "More sounds" escape for anything not enumerated here.
 */
export async function listRingtones(type) {
  if (!Capacitor.isNativePlatform()) return { items: [], current: null }
  try { return await Ringtone.list({ type }) } catch { return { items: [], current: null } }
}

/** Play one sound. Passing nothing stops whatever is playing. */
export async function previewRingtone(uri) {
  if (!Capacitor.isNativePlatform()) return
  try { await Ringtone.preview({ uri: uri || '' }) } catch { /* silence is fine */ }
}

export async function stopPreview() {
  if (!Capacitor.isNativePlatform()) return
  try { await Ringtone.stopPreview() } catch { /* nothing playing */ }
}

/** Save a choice from the app's own list. An empty uri means "default". */
export async function setRingtone(type, uri) {
  if (!Capacitor.isNativePlatform()) return { title: null }
  try { return await Ringtone.set({ type, uri: uri || '' }) } catch { return { title: null } }
}

/**
 * Pick any audio file — a song, a download, a recording — from outside the
 * ringtone list, which holds registered ringtones only.
 *
 * `source` picks which app opens: 'music' goes to the phone's music app and its
 * song list, 'files' to the file manager. They are separate buttons on the
 * sheet because they answer different questions — "which song?" and "which
 * file?" — and one combined button could only ever open one of them.
 */
export async function pickAudioFile(type, source = 'files') {
  if (!Capacitor.isNativePlatform()) return { changed: false }
  try { return await Ringtone.pickFile({ type, source }) } catch { return { changed: false } }
}

/** Back to the app's built-in sound for one alert. */
export async function resetRingtone(type) {
  if (!Capacitor.isNativePlatform()) return
  try { await Ringtone.reset({ type }) } catch { /* keeps the old choice */ }
}
