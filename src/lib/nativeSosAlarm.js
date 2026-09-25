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
export async function triggerNativeSOSAlert({ sender, message, lat, lng, phone, sosId } = {}) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await SOSAlarm.trigger({
      sender:  sender  || 'A family member',
      message: message || 'SOS Alert',
      lat:     lat != null ? String(lat) : '',
      lng:     lng != null ? String(lng) : '',
      phone:   phone || '',
      sosId:   sosId || '',
    })
  } catch (e) {
    console.warn('[nativeSosAlarm] trigger failed:', e)
  }
}

/**
 * The sender marked themselves safe. Natively this stops the siren for THAT
 * alert and turns the alert screen into its "safe now" state (or posts a
 * notification if the screen is gone) — the same handling as the sos_resolved
 * push, whichever arrives first.
 */
export async function showNativeSOSResolved({ sosId, sender } = {}) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await SOSAlarm.showResolved({ sosId: sosId || '', sender: sender || '' })
  } catch (e) {
    console.warn('[nativeSosAlarm] showResolved failed:', e)
  }
}

/**
 * Keep this phone silent while its owner's SOS is open, and give the ringer
 * back once it is resolved. The sender may be hiding, and the family starts
 * calling the moment the alert goes out. Both are no-ops natively when already
 * in that state. See SosSilence.java.
 */
export async function enterSosSilence() {
  if (!Capacitor.isNativePlatform()) return
  try { await SOSAlarm.enterSosSilence() } catch (e) {
    console.warn('[nativeSosAlarm] enterSosSilence failed:', e)
  }
}

export async function exitSosSilence() {
  if (!Capacitor.isNativePlatform()) return
  try { await SOSAlarm.exitSosSilence() } catch (e) {
    console.warn('[nativeSosAlarm] exitSosSilence failed:', e)
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

/**
 * SOS Quick Settings tile (Profile → Safety). Returns null on web or on a
 * native build without the methods, so the card can hide itself.
 */
export async function getSosTile() {
  if (!Capacitor.isNativePlatform()) return null
  try { return await SOSAlarm.getSosTile() } catch { return null }
}

export async function setSosTile(enabled) {
  return SOSAlarm.setSosTile({ enabled: !!enabled })
}
