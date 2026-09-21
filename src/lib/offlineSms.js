/**
 * offlineSms.js
 *
 * Offline SMS alerts: when the phone has no data, the app texts the family
 * admins — and one number the member chooses — their last known position.
 *
 * The numbers live in native storage, refreshed from the server whenever there
 * IS data, because the code that sends the text runs with no WebView and no
 * network at all.
 *
 * Android only; every function is a no-op elsewhere.
 */

import { Capacitor } from '@capacitor/core'
import { LocationService } from './locationPlugin'
import { supabase } from './supabase'

export const isOfflineSmsAvailable = () => Capacitor.getPlatform() === 'android'

/** { enabled, extraNumber, hasPermission, recipients } or null when unavailable. */
export async function getOfflineSms() {
  if (!isOfflineSmsAvailable()) return null
  try { return await LocationService.getOfflineSms() } catch { return null }
}

/**
 * Saves the switch and the extra number. Asks for the SMS permission when
 * switching on — Android will not send anything without it, and asking at the
 * moment someone opts in is the only place it makes sense.
 *
 * @returns { saved, granted }
 */
export async function saveOfflineSms({ enabled, extraNumber }) {
  if (!isOfflineSmsAvailable()) return { saved: false, granted: false }

  let granted = false
  if (enabled) {
    try {
      const res = await LocationService.requestSmsPermission()
      granted = !!res?.granted
    } catch (e) {
      console.warn('[offlineSms] permission request failed:', e?.message || e)
    }
    // Refused: do not store "on". A switch that says on while Android blocks
    // every message is worse than one that will not move.
    if (!granted) return { saved: false, granted: false }
  }

  try {
    await LocationService.setOfflineSms({ enabled: !!enabled, extraNumber: extraNumber || '' })
    return { saved: true, granted: enabled ? granted : false }
  } catch (e) {
    console.warn('[offlineSms] save failed:', e?.message || e)
    return { saved: false, granted }
  }
}

/**
 * Sends one alert immediately, so the member can check their number works
 * without spending 15 minutes offline first.
 *
 * @returns how many numbers were texted; 0 means nothing went out.
 */
export async function sendTestOfflineSms() {
  if (!isOfflineSmsAvailable()) return 0
  try {
    const res = await LocationService.sendTestOfflineSms()
    return res?.sent || 0
  } catch (e) {
    console.warn('[offlineSms] test send failed:', e?.message || e)
    return 0
  }
}

/**
 * Caches who to text: the admins of every family the member is in, plus the
 * name their family knows them by. Called while online; silently does nothing
 * when it cannot reach the server, leaving the last good list in place.
 */
export async function refreshOfflineSmsContacts(userId) {
  if (!isOfflineSmsAvailable() || !userId) return

  try {
    const { data: mine } = await supabase
      .from('family_members')
      .select('family_id, display_name')
      .eq('user_id', userId)
    if (!mine?.length) return

    const { data: admins } = await supabase
      .from('family_members')
      .select('phone, user_id')
      .in('family_id', mine.map(m => m.family_id))
      .eq('role', 'admin')

    const numbers = [...new Set(
      (admins || [])
        .filter(a => a.user_id !== userId && a.phone)
        .map(a => String(a.phone).trim())
        .filter(Boolean)
    )]

    await LocationService.setOfflineSmsContacts({
      admins: numbers,
      senderName: mine[0]?.display_name || '',
    })
  } catch (e) {
    console.warn('[offlineSms] could not refresh contacts:', e?.message || e)
  }
}
