import { useEffect, useRef } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'

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
export function useLocationBroadcast(userId, familyId) {
  const watchRef      = useRef(null)
  const lastCoordsRef = useRef(null)
  const sharingRef    = useRef(true)

  useEffect(() => {
    if (!userId || !familyId) return

    let cancelled = false
    let intervalId = null

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
    const write = async (lat, lng, accuracy, speed) => {
      if (cancelled) return

      if (!sharingRef.current) {
        // Privacy off — flag the row so pins are hidden for this user
        await supabase.from('locations').upsert({
          user_id: userId, family_id: familyId,
          is_sharing: false, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,family_id' })
        return
      }

      try {
        // Preferred: secure RPC (user_id resolved server-side via auth.uid())
        const { error } = await supabase.rpc('upsert_location_with_battery', {
          p_family_id:   familyId,
          p_lat:         lat,
          p_lng:         lng,
          p_accuracy:    accuracy || 0,
          p_speed:       speed ?? null,
          p_battery:     null,
          p_is_charging: false,
        })
        if (error) throw error
      } catch (e) {
        // Fallback: direct upsert (RLS still enforces user_id = auth.uid())
        await supabase.from('locations').upsert({
          user_id: userId, family_id: familyId,
          lat, lng, accuracy: accuracy || 0, speed: speed ?? null,
          is_sharing: true, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,family_id' })
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
