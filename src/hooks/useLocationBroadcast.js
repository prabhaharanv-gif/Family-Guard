import { useEffect, useRef } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { startBatteryReporting } from './useBattery'

/**
 * Global, always-on location writer.
 *
 * Runs whenever the app is open on ANY platform (web or native). This is the
 * piece that keeps every member's pin fresh — previously location was only
 * written while the Map tab was open (via watchPosition) or by the native-only
 * background service, so a user's pin froze the moment they left the map.
 *
 * Strategy:
 *   - watchPosition() streams GPS updates as the user moves.
 *   - A 45s interval forces a fresh write even when stationary, so the
 *     timestamp keeps advancing and other members can see the pin is "live".
 *   - Respects the member's show_location privacy toggle.
 */
// ── Location quality filters ─────────────────────────────────────────────────
// Reject fixes worse than this. Loosened from 50m to 100m so normal indoor
// WiFi/cell fixes are accepted instead of silently rejected — matches the
// native LocationForegroundService gate.
const MAX_ACCURACY_M = 100       // metres — discard anything worse than this
// Until this device has written ANYTHING for this family there is no row in
// `locations` at all, and the Family list has nothing to draw: the member shows
// as if they were not sharing. Indoors on WiFi the first fix is routinely worse
// than 100m, so the strict gate above could keep somebody who had just joined
// invisible for as long as they stayed inside. A rough first position is far
// better than none — the normal gate applies from the second write on.
const FIRST_FIX_ACCURACY_M = 2000
// Only write if the user has moved more than this from the last written position
// Eliminates GPS noise making a stationary pin drift around
const MIN_MOVE_M     = 15        // metres
// Write at least this often even when stationary, so the pin stays "live"
const HEARTBEAT_MS   = 90_000    // 90 seconds
// A single bad fix (stale WiFi AP entry, cell-tower fallback, GPS multipath) can
// report a "plausible" accuracy while being far off, making the pin teleport and
// snap back on the next good fix. Anything implying faster than this is held back
// until a second fix roughly confirms it — matches the native background gate.
const MAX_PLAUSIBLE_SPEED_MPS = 55       // ~200 km/h
const JUMP_CONFIRM_RADIUS_M   = 50

// Haversine distance in metres between two lat/lng pairs
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat  = toRad(lat2 - lat1)
  const dLng  = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function useLocationBroadcast(userId, familyId) {
  const watchRef       = useRef(null)
  const lastCoordsRef  = useRef(null)
  const lastWrittenRef = useRef(null)   // last coords actually written to DB
  const lastWriteTimeRef = useRef(0)    // timestamp of last write — for heartbeat
  const pendingJumpRef = useRef(null)   // an implausibly-fast fix awaiting confirmation
  const sharingRef     = useRef(true)
  const batteryRef     = useRef({ level: null, charging: false })

  useEffect(() => {
    if (!userId || !familyId) return

    let cancelled = false
    let intervalId = null

    // Start battery reporting — updates batteryRef whenever level/charging changes
    const stopBattery = startBatteryReporting(({ level, charging }) => {
      batteryRef.current = { level, charging }
    })

    // Check the member's privacy preference once, then cache it.
    const checkSharing = async () => {
      const { data } = await supabase
        .from('family_members')
        .select('show_location')
        .eq('user_id', userId)
        .eq('family_id', familyId)
        .single()
      sharingRef.current = !(data && data.show_location === false)
      return sharingRef.current
    }

    // Write current coords to the DB (or mark as not-sharing).
    // The locations.speed column is km/h — that is what
    // LocationForegroundService writes (loc.getSpeed() * 3.6f) and it is the
    // primary writer on Android. The Geolocation API reports metres/second,
    // so this path has to convert or the same column ends up holding two
    // different units depending on which writer last ran.
    const toKmh = (mps) => (mps == null || Number.isNaN(mps) ? null : mps * 3.6)

    const write = async (lat, lng, accuracy, speed) => {
      if (cancelled) return

      // ── Quality gate ──────────────────────────────────────────────────────
      // Reject fixes with poor accuracy (cell tower / network fallback).
      // These are the main cause of pins jumping while the user is stationary.
      const accuracyLimit = lastWrittenRef.current ? MAX_ACCURACY_M : FIRST_FIX_ACCURACY_M
      if (accuracy != null && accuracy > accuracyLimit) {
        console.warn(`[LocationBroadcast] Discarding poor fix — accuracy ${Math.round(accuracy)}m > ${accuracyLimit}m`)
        return
      }

      // Jump gate — reject a fix that implies unrealistic speed from the last
      // written position unless a second fix roughly confirms it. Catches the
      // "pin teleports far away then snaps back" pattern before it ever writes.
      if (lastWrittenRef.current) {
        const jumpDist  = distanceM(lastWrittenRef.current.lat, lastWrittenRef.current.lng, lat, lng)
        const elapsedMs = Date.now() - lastWriteTimeRef.current
        // Clamp elapsed time for the speed check — see LocationForegroundService.java
        // for why: a stale heartbeat-gap baseline otherwise makes multi-km jumps look
        // like plausible low speed even though the person hasn't actually moved.
        const speedElapsedMs = Math.min(elapsedMs, 20_000)
        const impliedMps = speedElapsedMs > 0 ? jumpDist / (speedElapsedMs / 1000) : 0
        if (impliedMps > MAX_PLAUSIBLE_SPEED_MPS) {
          const pending = pendingJumpRef.current
          const confirmed = pending && distanceM(pending.lat, pending.lng, lat, lng) <= JUMP_CONFIRM_RADIUS_M
          if (confirmed) {
            pendingJumpRef.current = null
          } else {
            console.warn(`[LocationBroadcast] Rejected as GPS jump — ${Math.round(jumpDist)}m in ${elapsedMs}ms (${Math.round(impliedMps * 3.6)}km/h implied)`)
            pendingJumpRef.current = { lat, lng }
            return
          }
        } else {
          pendingJumpRef.current = null
        }
      }

      // Only write if the user has moved MIN_MOVE_M from the last written
      // position, OR if HEARTBEAT_MS has elapsed since the last write. Without
      // the heartbeat, a stationary user's timestamp never advances and their
      // pin shows as stale ("last seen 3h ago") even though the app is running.
      if (lastWrittenRef.current) {
        const moved = distanceM(
          lastWrittenRef.current.lat, lastWrittenRef.current.lng, lat, lng
        )
        const sinceLastWrite = Date.now() - lastWriteTimeRef.current
        if (moved < MIN_MOVE_M && sinceLastWrite < HEARTBEAT_MS) return
      }
      // ─────────────────────────────────────────────────────────────────────

      if (!sharingRef.current) {
        // Privacy off — flag the row so pins are hidden for this user
        await supabase.from('locations').upsert({
          user_id: userId, family_id: familyId,
          is_sharing: false, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,family_id' })
        return
      }

      try {
        // Preferred: secure RPC (user_id resolved server-side via auth.uid()),
        // writing EVERY family this person belongs to rather than only the one
        // the app currently has open. Scoped to the active family, the others
        // froze at the last position from when they were last active, and a
        // newly joined family never got a row at all — its members saw
        // "Waiting" forever with the phone's GPS working perfectly. The RPC
        // skips families the member has hidden their location from. See
        // 20260901030000_location_all_families.
        const { error } = await supabase.rpc('upsert_location_all_families', {
          p_lat:         lat,
          p_lng:         lng,
          p_accuracy:    accuracy || 0,
          p_speed:       toKmh(speed),
          p_battery:     batteryRef.current.level,
          p_is_charging: batteryRef.current.charging,
        })
        // An older database without the new function still has to report
        // somewhere, so fall back to the single-family one rather than losing
        // the fix entirely.
        if (error) {
          const { error: oneErr } = await supabase.rpc('upsert_location_with_battery', {
            p_family_id:   familyId,
            p_lat:         lat,
            p_lng:         lng,
            p_accuracy:    accuracy || 0,
            p_speed:       toKmh(speed),
            p_battery:     batteryRef.current.level,
            p_is_charging: batteryRef.current.charging,
          })
          if (oneErr) throw oneErr
        }
        lastWrittenRef.current = { lat, lng }
        lastWriteTimeRef.current = Date.now()
      } catch (e) {
        // Fallback: direct upsert (RLS still enforces user_id = auth.uid())
        await supabase.from('locations').upsert({
          user_id: userId, family_id: familyId,
          lat, lng, accuracy: accuracy || 0, speed: toKmh(speed),
          is_sharing: true, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,family_id' })
        lastWrittenRef.current = { lat, lng }
        lastWriteTimeRef.current = Date.now()
      }
    }

    const getPosition = async () => {
      // Native path
      if (Capacitor.isNativePlatform()) {
        try {
          return await Geolocation.getCurrentPosition({
            enableHighAccuracy: true, timeout: 20000, maximumAge: 10000,
          })
        } catch {
          return await Geolocation.getCurrentPosition({
            enableHighAccuracy: false, timeout: 25000, maximumAge: 60000,
          })
        }
      }
      // Web path
      return await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('No geolocation')); return }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 20000, maximumAge: 10000,
        })
      })
    }

    const start = async () => {
      await checkSharing()

      // 1) Immediate first fix
      try {
        const pos = await getPosition()
        lastCoordsRef.current = pos.coords
        await write(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed)
      } catch (e) {
        console.warn('[LocationBroadcast] Initial fix failed:', e?.message)
      }

      // 2) Continuous watch — fires as the user moves
      try {
        if (Capacitor.isNativePlatform()) {
          watchRef.current = await Geolocation.watchPosition(
            { enableHighAccuracy: true },
            (p, err) => {
              if (err || !p || cancelled) return
              lastCoordsRef.current = p.coords
              write(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.speed)
            }
          )
        } else if (navigator.geolocation) {
          watchRef.current = navigator.geolocation.watchPosition(
            (p) => {
              if (cancelled) return
              lastCoordsRef.current = p.coords
              write(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.speed)
            },
            (err) => console.warn('[LocationBroadcast] Watch error:', err?.message),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 25000 }
          )
        }
      } catch (e) {
        console.warn('[LocationBroadcast] Watch setup failed:', e?.message)
      }

      // 3) Heartbeat write every 20s — keeps the timestamp fresh even when
      //    stationary, so other members see the pin as "live" not stale.
      //    While moving, watchPosition (above) fires far more often, giving
      //    the receiving side frequent small steps to animate smoothly.
      intervalId = setInterval(async () => {
        if (cancelled) return
        // Re-check privacy periodically in case the user toggled it
        await checkSharing()
        const c = lastCoordsRef.current
        if (c) {
          await write(c.latitude, c.longitude, c.accuracy, c.speed)
        } else {
          // No cached fix yet — try once more
          try {
            const pos = await getPosition()
            lastCoordsRef.current = pos.coords
            await write(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed)
          } catch {}
        }
      }, 20_000)
    }

    start()

    return () => {
      cancelled = true
      stopBattery()
      if (intervalId) clearInterval(intervalId)
      if (watchRef.current != null) {
        if (Capacitor.isNativePlatform()) {
          Geolocation.clearWatch({ id: watchRef.current }).catch(() => {})
        } else if (navigator.geolocation) {
          navigator.geolocation.clearWatch(watchRef.current)
        }
        watchRef.current = null
      }
    }
  }, [userId, familyId])
}
