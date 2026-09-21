/**
 * fakeCall.js
 *
 * Bridge to the native FakeCall plugin: a pretend incoming call someone can
 * trigger to get out of an uncomfortable situation.
 *
 * Settings live in native SharedPreferences, because the lock-screen
 * notification button starts the call with no WebView attached. Nothing here
 * is sent to the server.
 *
 * Android only — every function resolves to a harmless value elsewhere.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const FakeCall = registerPlugin('FakeCall')

export const isFakeCallAvailable = () => Capacitor.getPlatform() === 'android'

/** The timer choices offered in Profile, in seconds. */
export const FAKE_CALL_DELAYS = [10, 30, 60]

/** { name, number, voice, notificationButton }, or null when unavailable. */
export async function getFakeCallSettings() {
  if (!isFakeCallAvailable()) return null
  try { return await FakeCall.getSettings() } catch { return null }
}

export async function saveFakeCallSettings({ name, number, voice, notificationButton }) {
  if (!isFakeCallAvailable()) return false
  try {
    await FakeCall.setSettings({
      name: (name || '').trim(),
      number: (number || '').trim(),
      voice: !!voice,
      notificationButton: !!notificationButton,
    })
    return true
  } catch (e) {
    console.warn('[fakeCall] save failed:', e?.message || e)
    return false
  }
}

/** Rings after `seconds`. Replaces a call that is already scheduled. */
export async function scheduleFakeCall(seconds) {
  if (!isFakeCallAvailable()) return false
  try {
    await FakeCall.schedule({ seconds })
    return true
  } catch (e) {
    console.warn('[fakeCall] schedule failed:', e?.message || e)
    return false
  }
}

export async function cancelFakeCall() {
  if (!isFakeCallAvailable()) return
  try { await FakeCall.cancel() } catch { /* nothing scheduled */ }
}

/** { state: 'idle' | 'scheduled' | 'ringing', ringAt } */
export async function getFakeCallStatus() {
  if (!isFakeCallAvailable()) return { state: 'idle', ringAt: 0 }
  try { return await FakeCall.getStatus() } catch { return { state: 'idle', ringAt: 0 } }
}

/** Whole seconds left before a scheduled call rings; never negative. */
export function secondsUntil(ringAt, now = Date.now()) {
  return Math.max(0, Math.ceil((ringAt - now) / 1000))
}
