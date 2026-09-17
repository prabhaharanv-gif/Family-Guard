import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { supabase } from '../lib/supabase'
import { LocationService } from '../lib/locationPlugin'

/**
 * Reports whether this phone is CAPABLE of sharing location in the background.
 *
 * WHY: a member whose location stops updating looks identical, from the family's
 * side and from the database, whether their phone was killed, denied background
 * location, or simply switched off. Working that out used to mean comparing
 * timestamps across tables and guessing. The phone knows the answer — it just
 * never told anyone.
 *
 * The reading is taken while the app is open and working, which is the only time
 * it can be sent. That is not a limitation to work around: a phone that has gone
 * dark cannot report why, so the useful record is always the one from before.
 * "Last time we heard from her, background location was denied" explains a silent
 * member far better than anything measurable after the fact.
 *
 * Written to the member's own locations rows — every family they belong to, since
 * these are facts about the device rather than about one family. RLS already
 * restricts the update to their own rows.
 */

// Reporting on every resume would write far more often than the values change.
// They only move when the member visits system settings, so an hour is plenty.
const REPORT_EVERY_MS = 60 * 60 * 1000
let lastReportedAt = 0
let lastPayloadKey = null

export async function reportDeviceHealth(userId, { force = false } = {}) {
  if (!Capacitor.isNativePlatform() || !userId) return

  try {
    const h = await LocationService.getDeviceHealth()
    const payload = {
      bg_location_granted: h?.bgLocation === true,
      battery_opt_ignored: h?.batteryOptIgnored === true,
      app_version:         h?.appVersion ?? null,
    }

    // Skip an unchanged reading unless it is due anyway, so a member who opens
    // the app twenty times a day does not write twenty identical rows.
    const key = JSON.stringify(payload)
    const due = Date.now() - lastReportedAt > REPORT_EVERY_MS
    if (!force && !due && key === lastPayloadKey) return

    const { error } = await supabase
      .from('locations')
      .update(payload)
      .eq('user_id', userId)

    if (error) {
      // The columns may not exist yet on an older database. That must not break
      // anything: this is diagnostics, and the app has to keep working without
      // it. Logged once rather than every hour.
      if (key !== lastPayloadKey) {
        console.warn('[DeviceHealth] Not reported:', error.message)
      }
      lastPayloadKey = key
      return
    }

    lastReportedAt = Date.now()
    lastPayloadKey = key
  } catch (e) {
    console.warn('[DeviceHealth] Could not read device health:', e?.message)
  }
}

export function useDeviceHealth(userId) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return

    // On open: the state may have changed in system settings since last time,
    // and a member who has just been through the permission prompts is exactly
    // who you want an up-to-date reading for.
    reportDeviceHealth(userId, { force: true })

    let handle = null
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) reportDeviceHealth(userId)
    }).then((h) => { handle = h }).catch(() => {})

    return () => { handle?.remove() }
  }, [userId])
}
