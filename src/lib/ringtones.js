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
  try { return await Ringtone.pick({ type }) } catch { return { changed: false } }
}

/** Back to the app's built-in sound for one alert. */
export async function resetRingtone(type) {
  if (!Capacitor.isNativePlatform()) return
  try { await Ringtone.reset({ type }) } catch { /* keeps the old choice */ }
}
