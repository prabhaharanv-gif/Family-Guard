/**
 * places.js
 *
 * "Home", "Office", ... — per-member saved places. Each is owned by the
 * signed-in user alone (RLS is owner-only on the places table); the family
 * only ever learns the arrival/departure EVENT ("Prabhakar reached Home"),
 * never the coordinates. All writes go through SECURITY DEFINER RPCs, same
 * as every other native/web write path in this app.
 *
 * The actual geofence detection runs natively (PlaceGeofence.java, inside
 * LocationForegroundService) — this module only manages the place list and
 * tells the native side to refresh right after a change, the same bridge
 * mechanism setShakeSosEnabled/setSharing already use.
 */

import { Geolocation } from '@capacitor/geolocation'
import { supabase } from './supabase'
import { LocationService } from './locationPlugin'

/** Same fallback chain as MapAllPage's getPositionRobust, for a one-shot fix. */
async function getPositionRobust() {
  try {
    return await Geolocation.getCurrentPosition({
      enableHighAccuracy: true, timeout: 20000, maximumAge: 30000,
    })
  } catch (e1) {
    console.warn('[places] High-accuracy fix failed:', e1?.message)
  }
  try {
    return await Geolocation.getCurrentPosition({
      enableHighAccuracy: false, timeout: 25000, maximumAge: 300000,
    })
  } catch (e2) {
    console.warn('[places] Low-accuracy fix failed:', e2?.message)
  }
  return await new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return }
    navigator.geolocation.getCurrentPosition(
      resolve, reject, { enableHighAccuracy: false, timeout: 25000, maximumAge: 300000 }
    )
  })
}

/** Tells a running LocationForegroundService to reload the place list now. */
async function refreshNative() {
  try { await LocationService.refreshPlaces() } catch { /* not on Android, or not running yet */ }
}

/** This member's saved places, newest last. */
export async function listMyPlaces() {
  const { data, error } = await supabase.rpc('list_my_places')
  if (error) { console.error('[places] list failed:', error.code || 'unknown'); return [] }
  return data || []
}

/** Gets a fresh fix and saves it under `name` (upserts if the name already exists). */
export async function saveCurrentLocationAsPlace(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { ok: false, error: 'empty-name' }

  let pos
  try {
    pos = await getPositionRobust()
  } catch (e) {
    console.warn('[places] could not get a fix:', e?.message || e)
    return { ok: false, error: 'no-fix' }
  }

  const { data, error } = await supabase.rpc('save_place', {
    p_name: trimmed,
    p_lat:  pos.coords.latitude,
    p_lng:  pos.coords.longitude,
  })
  if (error) { console.error('[places] save failed:', error.code || 'unknown'); return { ok: false, error: error.code } }

  await refreshNative()
  return { ok: true, id: data }
}

export async function renamePlace(placeId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return false
  const { error } = await supabase.rpc('rename_place', { p_place_id: placeId, p_name: trimmed })
  if (error) { console.error('[places] rename failed:', error.code || 'unknown'); return false }
  await refreshNative()
  return true
}

export async function deletePlace(placeId) {
  const { error } = await supabase.rpc('delete_place', { p_place_id: placeId })
  if (error) { console.error('[places] delete failed:', error.code || 'unknown'); return false }
  await refreshNative()
  return true
}
