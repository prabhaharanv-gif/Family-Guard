import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { supabase } from '../lib/supabase'
import { startBatteryReporting } from './useBattery'

/**
 * Keeps the family card's battery figure true whether or not GPS is running.
 *
 * Battery used to travel only inside a location upload, so with GPS off the card
 * kept the last value it had ever received. Battery is a fact about the phone,
 * not about a position, so it gets its own write.
 *
 * Only battery_level and is_charging are written. updated_at is deliberately left
 * alone: it means "when this position was measured", and bumping it here would
 * make a stale pin look fresh.
 *
 * Runs while the app is open and on every resume. Nothing here runs once the
 * app is killed; while GPS is on, the location service keeps carrying battery too.
 */
const PERCENT_STEP = 1   // any 1% move or plug/unplug is worth a write

export function useBatterySync(userId) {
  useEffect(() => {
    if (!userId) return

    let latest = null
    let lastSent = null
    let inFlight = false

    const flush = async (force = false) => {
      if (!latest || latest.level == null || inFlight) return
      const changed = !lastSent
        || Math.abs(latest.level - lastSent.level) >= PERCENT_STEP
        || latest.charging !== lastSent.charging
      if (!force && !changed) return

      inFlight = true
      const snap = latest
      try {
        const { error } = await supabase
          .from('locations')
          .update({ battery_level: snap.level, is_charging: snap.charging })
          .eq('user_id', userId)
        if (!error) lastSent = snap
      } catch { /* best effort — the card just stays on its last value */ }
      inFlight = false
    }

    const stop = startBatteryReporting((b) => { latest = b; flush() })

    let handle = null
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        // Force on resume: the last write may be hours old even if the value is
        // the same, and the family should see this phone is alive and current.
        if (isActive) flush(true)
      }).then((h) => { handle = h }).catch(() => {})
    }

    return () => { stop(); handle?.remove() }
  }, [userId])
}
