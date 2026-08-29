/**
 * nativeCallAlarm.js
 *
 * Capacitor bridge to the native Android CallAlarm plugin.
 * Rings + wakes the screen when an incoming call arrives while the app is
 * alive but not in the foreground JS context (mirrors nativeSosAlarm.js).
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const CallAlarm = registerPlugin('CallAlarm')

export async function triggerNativeCallAlert({ callId, callerName, callerAvatar, callType } = {}) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CallAlarm.trigger({
      callId:     callId || '',
      callerName: callerName || 'A family member',
      callType:   callType || 'voice',
      callerAvatar: callerAvatar || '',
    })
  } catch (e) {
    console.warn('[nativeCallAlarm] trigger failed:', e)
  }
}

export async function stopNativeCallAlarm() {
  if (!Capacitor.isNativePlatform()) return
  try { await CallAlarm.stop() } catch (e) {
    console.warn('[nativeCallAlarm] stop failed:', e)
  }
}

export async function isNativeCallAlarmRinging() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const res = await CallAlarm.isRinging()
    return !!res?.ringing
  } catch (e) {
    return false
  }
}
