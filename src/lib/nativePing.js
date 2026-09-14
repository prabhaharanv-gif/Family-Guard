/**
 * nativePing.js
 *
 * Capacitor bridge to the native PingRing plugin.
 *
 * Find My Phone rings from PingRingService, started by FCM, so it works with
 * the app closed. These calls are what let the in-app UI silence it once the
 * phone has been found and its owner has opened the app — previously the only
 * way to stop the noise was the Stop action on the notification.
 *
 * Mirrors nativeSosAlarm.js, deliberately: the siren and the ping should be
 * silenced the same way.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const PingRing = registerPlugin('PingRing')

/** Silence the ring. No-op on web, and safe when nothing is ringing. */
export async function stopNativePing() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await PingRing.stop()
  } catch (e) {
    console.warn('[nativePing] stop failed:', e)
  }
}

/** Whether the ring is sounding right now. False on web, and on any error. */
export async function isNativePingRinging() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const res = await PingRing.isRinging()
    return !!res?.ringing
  } catch {
    // Plugin missing or the bridge is not up yet. "Not ringing" is the safe
    // answer: it only hides a control, it never leaves a noise unstoppable.
    return false
  }
}
