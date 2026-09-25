import { useEffect, useRef } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { LocationService } from '../lib/locationPlugin'
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
// How often the heartbeat timer fires. Native has no watchPosition of its own
// any more and reads a cached fix instead, so it can tick slowly; web still
// pays for its own watch and keeps the original cadence.
const TICK_MS = Capacitor.isNativePlatform() ? 60_000 : 20_000
// How old a native fix may be before a fresh one is worth requesting. The
// foreground service refreshes far more often than this, so the read is
// normally a cache hit that costs no additional GPS.
const CACHED_FIX_MAX_AGE_MS = 60_000
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

// How old the native service's last pushed fix may be and still be written
// here. The service re-pushes at least every 90s (its heartbeat), so anything
// older means it is not running and this hook falls back to asking for a fix.
const NATIVE_FIX_MAX_AGE_MS = 3 * 60 * 1000

/**
 * The native service's last pushed fix, shaped like GeolocationCoordinates, or
 * null. On Android this is the position source for this hook: it already passed
 * the service's accuracy and jump filters. This hook used to take its own
 * low-accuracy fix instead and write it to every family — a 90m Wi-Fi guess
 * written over the service's 20m GPS fix, which flipped a still member's pin
 * ~100m back and forth (Redmi, 2026-09-21).
 */
async function nativeLastFix() {
  try {
    const f = await LocationService.getLastFix()
    if (!f?.found || Date.now() - f.time > NATIVE_FIX_MAX_AGE_MS) return null
    return { latitude: f.lat, longitude: f.lng, accuracy: f.accuracy, speed: f.speed ?? null }
  } catch {
    return null   // older native build without getLastFix
  }
}

export function useLocationBroadcast(userId, familyId) {
  const watchRef       = useRef(null)
  const lastCoordsRef  = useRef(null)
  const lastWrittenRef = useRef(null)   // last coords actually written to DB
  const lastWriteTimeRef = useRef(0)    // timestamp of last write — for heartbeat
  const pendingJumpRef = useRef(null)   // an implausibly-fast fix awaiting confirmation
  const sharingRef     = useRef(true)
  // What was last mirrored to the native side. null = nothing sent yet, so the
  // first check always mirrors, whatever the native flag happens to hold.
  const lastSentSharingRef = useRef(null)
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
      const sharing = !(data && data.show_location === false)

      // This hook is the only thing that reads the live value regularly, so it
      // is also what tells the native side about a change made somewhere else —
      // the toggle on another device, or a value that was already off when this
      // one signed in. Compared against what was last SENT rather than against
      // sharingRef, which starts out optimistically true: if the member opted
      // out here and back in elsewhere, the native flag would still be false
      // while sharingRef already agreed with the database, and nothing would
      // ever correct it — tracking would stay blocked on this phone.
      //
      // Only on a change: the native call stops or starts the foreground
      // service, so firing it every tick would churn it.
      if (sharing !== lastSentSharingRef.current && Capacitor.isNativePlatform()) {
        try {
          await LocationService.setSharing({ sharing })
          lastSentSharingRef.current = sharing
        } catch (e) {
          console.warn('[LocationBroadcast] Could not mirror the sharing flag:', e?.message)
        }
      }

      sharingRef.current = sharing
      return sharing
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
      //
      // Accuracy-aware, matching LocationFilter.java: a fix only counts as
      // movement when it lands further away than its own error, or when it is
      // at least twice as precise as what is on the map (a rough pin being
      // corrected). A heartbeat carrying a WORSE fix re-sends the last written
      // position with a fresh timestamp instead of moving the pin onto it.
      if (lastWrittenRef.current) {
        const last = lastWrittenRef.current
        const moved = distanceM(last.lat, last.lng, lat, lng)
        const sinceLastWrite = Date.now() - lastWriteTimeRef.current
        const acc = accuracy ?? 0
        const lastAcc = last.accuracy ?? 0
        const realMove = moved >= Math.max(MIN_MOVE_M, acc > 30 ? acc * 2 : acc)
        const upgrade  = lastAcc > 0 && acc > 0 && acc * 2 <= lastAcc && moved >= MIN_MOVE_M
        if (!realMove && !upgrade) {
          if (sinceLastWrite < HEARTBEAT_MS) return
          if (lastAcc > 0 && acc > lastAcc) {
            lat = last.lat
            lng = last.lng
            accuracy = lastAcc
          }
        }
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
        lastWrittenRef.current = { lat, lng, accuracy }
        lastWriteTimeRef.current = Date.now()
      } catch (e) {
        // Fallback: direct upsert (RLS still enforces user_id = auth.uid())
        await supabase.from('locations').upsert({
          user_id: userId, family_id: familyId,
          lat, lng, accuracy: accuracy || 0, speed: toKmh(speed),
          is_sharing: true, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,family_id' })
        lastWrittenRef.current = { lat, lng, accuracy }
        lastWriteTimeRef.current = Date.now()
      }
    }

    const getPosition = async () => {
      // Native path — the service's filtered fix first, see nativeLastFix.
      if (Capacitor.isNativePlatform()) {
        const fix = await nativeLastFix()
        if (fix) return { coords: fix }
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

      // 2) Continuous watch — WEB ONLY.
      //
      // On native this used to open a second high-accuracy watch on top of the
      // one LocationForegroundService already holds, so the phone ran two
      // independent continuous GPS clients for the same data. Passing no
      // interval made it worse than it looks: @capacitor/geolocation defaults
      // `interval` to `timeout` (10s) and `minimumUpdateInterval` to 5s, so it
      // sampled at nearly the service's rate. Battery stats showed 9h50m of GPS
      // against 4m of foreground use.
      //
      // The service stays the continuous source on native; the heartbeat below
      // keeps writing, because the service only covers ONE family and this path
      // writes every family the member belongs to.
      try {
        if (!Capacitor.isNativePlatform() && navigator.geolocation) {
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

      // 3) Heartbeat write — keeps the timestamp fresh even when stationary,
      //    so other members see the pin as "live" not stale.
      //
      //    On web, watchPosition above fires far more often while moving and
      //    this is only the stationary backstop, so it stays at 20s.
      //
      //    On native there is no watch here any more, so this IS the writer for
      //    the member's other families — and it runs at 60s, because the fix it
      //    writes comes from the cache the foreground service is already
      //    filling. The service keeps its own family fresh on its own 90s
      //    heartbeat regardless of this timer.
      intervalId = setInterval(async () => {
        if (cancelled) return
        // Re-check privacy every tick, as before: this hook must stop writing
        // is_sharing:true promptly after the member turns sharing off.
        await checkSharing()

        // Without a watch, lastCoordsRef would go stale after the first fix, so
        // refresh it. maximumAge means the fused provider answers from the fix
        // the service just took rather than powering the GPS a second time —
        // and enableHighAccuracy:false keeps a cache miss cheap instead of
        // forcing a fresh satellite fix.
        if (Capacitor.isNativePlatform()) {
          // The service's filtered fix; only if the service has none (not
          // running) ask the fused provider for its cached one.
          const fix = await nativeLastFix()
          if (fix) {
            lastCoordsRef.current = fix
          } else {
            try {
              const pos = await Geolocation.getCurrentPosition({
                enableHighAccuracy: false, timeout: 15000, maximumAge: CACHED_FIX_MAX_AGE_MS,
              })
              lastCoordsRef.current = pos.coords
            } catch (e) {
              console.warn('[LocationBroadcast] Cached fix unavailable:', e?.message)
            }
          }
        }

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
      }, TICK_MS)
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
