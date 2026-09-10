/**
 * nativeSosAlarm.js
 *
 * Capacitor bridge to the native Android SOSAlarm plugin.
 * Plays the siren when the app is CLOSED (Java side handles it).
 * These calls let the in-app UI silence it after the app is reopened.
 *
 * Extracted from App.jsx — no React dependency.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const SOSAlarm = registerPlugin('SOSAlarm')

export async function stopNativeSOSAlarm() {
  if (!Capacitor.isNativePlatform()) return
  try { await SOSAlarm.stop() } catch (e) {
    console.warn('[nativeSosAlarm] stop failed:', e)
  }
}

/**
 * Wake the screen and show the full-screen SOS alert via the native service.
 *
 * Used by the Realtime (websocket) path, which reaches the app while it is
 * alive but has no way to turn the display on from JS. This is also what makes
 * the noise: the native service plays the siren on the alarm stream for every
 * delivery path, which is why useSosAlarm.js keeps its Web Audio beeps for web
 * only. (An older comment here claimed this call was silent. It was not.)
 */
export async function triggerNativeSOSAlert({ sender, message, lat, lng } = {}) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await SOSAlarm.trigger({
      sender:  sender  || 'A family member',
      message: message || 'SOS Alert',
      lat:     lat != null ? String(lat) : '',
      lng:     lng != null ? String(lng) : '',
    })
  } catch (e) {
    console.warn('[nativeSosAlarm] trigger failed:', e)
  }
}

export async function isNativeSOSAlarmPlaying() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const res = await SOSAlarm.isPlaying()
    return !!res?.playing
  } catch (e) {
    return false
  }
}
