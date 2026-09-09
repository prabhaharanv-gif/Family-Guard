import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'

// Presence heartbeat.
//
// Marks the member online every 30s while the app is actually in the
// foreground, and flips them offline the instant it is backgrounded, closed or
// swiped away. Both calls go through SECURITY DEFINER RPCs that resolve the
// row from auth.uid() server-side, so a malicious client can't change another
// member's presence.
//
// Presence deliberately does NOT ride on location updates. It used to, via a
// `UPDATE family_members SET last_active = now()` at the end of
// upsert_location_with_battery, which LocationForegroundService posts to every
// 90s from the background — so a member showed Online for as long as their
// phone was on, app open or not. See the 20260829170000 migration.
const BEAT_MS = 30_000

export function useHeartbeat(userId, familyId) {
  // Held in a ref so the listener teardown below never races an in-flight beat
  // into a member who has already been marked offline.
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (!userId || !familyId) return

    stoppedRef.current = false
    let interval = null

    const beat = async () => {
      if (stoppedRef.current) return
      await supabase.rpc('update_member_heartbeat', { p_family_id: familyId })
    }

    const goOffline = async () => {
      await supabase.rpc('set_member_offline', { p_family_id: familyId })
    }

    const start = () => {
      if (interval) return
      beat()
      interval = setInterval(beat, BEAT_MS)
    }

    const stop = () => {
      if (interval) { clearInterval(interval); interval = null }
      goOffline()
    }

    start()

    // ── Foreground/background transitions ────────────────────────────────────
    const listeners = []

    if (Capacitor.isNativePlatform()) {
      // Fires on pause (home button, app switcher) and on swipe-away, which is
      // the case that made this bug visible. addListener resolves to a handle.
      const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
        stoppedRef.current = !isActive
        if (isActive) start()
        else stop()
      })
      listeners.push(handle)
    } else {
      const onVisibility = () => {
        const hidden = document.visibilityState === 'hidden'
        stoppedRef.current = hidden
        if (hidden) stop()
        else start()
      }
      // pagehide covers tab close and bfcache eviction, where visibilitychange
      // alone is not guaranteed to have fired first.
      const onPageHide = () => { stoppedRef.current = true; stop() }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onPageHide)
      listeners.push({
        remove: () => {
          document.removeEventListener('visibilitychange', onVisibility)
          window.removeEventListener('pagehide', onPageHide)
        },
      })
    }

    return () => {
      stoppedRef.current = true
      if (interval) { clearInterval(interval); interval = null }
      goOffline()
      listeners.forEach((l) => {
        // Native addListener returns a promise of the handle; web returns it directly.
        Promise.resolve(l).then((h) => { try { h.remove() } catch (e) {} }).catch(() => {})
      })
    }
  }, [userId, familyId])
}
