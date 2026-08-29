import { useEffect, useRef } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const LocationService = registerPlugin('LocationService')

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export function useLocationService() {
  const { user, familyId } = useAuthStore()
  const tokenRef     = useRef(null)
  const refreshTimer = useRef(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (!user || !familyId) return

    let cancelled  = false
    let retryTimer = null

    const startService = async () => {
      if (cancelled) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session?.access_token) {
          console.warn('[LocationService] No session token — retrying in 5s')
          retryTimer = setTimeout(startService, 5000)
          return
        }

        tokenRef.current = session.access_token

        await LocationService.start({
          supabaseUrl:  SUPABASE_URL,
          supabaseKey:  SUPABASE_KEY,
          userId:       user.id,
          familyId:     familyId,
          sessionToken: session.access_token,
          refreshToken: session.refresh_token,
        })

        console.log('[LocationService] ✅ Background service started')

        // ── Request ACCESS_BACKGROUND_LOCATION ("Allow all the time") ────────
        // Capacitor's Geolocation.requestPermissions() only grants FOREGROUND
        // location. On Android 10+ background location is a separate prompt —
        // without this the pin freezes the moment the app is backgrounded.
        // We request it here, after foreground is already granted.
        try {
          const bg = await LocationService.hasBackgroundPermission()
          if (!bg?.granted) {
            const res = await LocationService.requestBackgroundPermission()
            if (res?.granted) console.log('[LocationService] ✅ Background location granted')
            else console.warn('[LocationService] ⚠️ Background location NOT granted — pin will freeze when app is backgrounded')
          }
        } catch (e) {
          console.warn('[LocationService] Background permission request failed:', e?.message)
        }

        // ── Request battery optimization exemption ───────────────────────────
        // The #1 cause of location stopping when the app is CLOSED. Without this
        // exemption Android (and aggressively, OEM skins like MIUI/ColorOS/OneUI)
        // kills the foreground service to save power. This prompts the user once
        // to allow the app to run unrestricted in the background.
        try {
          const opt = await LocationService.isBatteryOptimizationIgnored()
          if (!opt?.ignored) {
            await LocationService.requestIgnoreBatteryOptimization()
            console.log('[LocationService] Prompted for battery optimization exemption')
          }
        } catch (e) {
          console.warn('[LocationService] Battery optimization request failed:', e?.message)
        }
      } catch (e) {
        console.warn('[LocationService] Failed to start:', e?.message)
        // Retry after 10 seconds if start fails
        retryTimer = setTimeout(startService, 10000)
      }
    }

    startService()

    // ── Proactively refresh token every 30 minutes ────────────────────────
    // Supabase tokens expire after 1 hour. Refresh at 30 min to stay safe.
    refreshTimer.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token && session.access_token !== tokenRef.current) {
          tokenRef.current = session.access_token
          await LocationService.updateSessionToken({ sessionToken: session.access_token, refreshToken: session.refresh_token })
          console.log('[LocationService] 🔄 Session token refreshed')
        }
      } catch (e) {
        console.warn('[LocationService] Token refresh failed:', e?.message)
      }
    }, 30 * 60 * 1000) // every 30 minutes

    // ── Also refresh on auth state change ────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.access_token && session.access_token !== tokenRef.current) {
          tokenRef.current = session.access_token
          try {
            await LocationService.updateSessionToken({ sessionToken: session.access_token, refreshToken: session.refresh_token })
            console.log('[LocationService] 🔄 Token updated on auth change:', event)
          } catch (e) {}
        }
      }
    )

    return () => {
      // Stop any retry chain that is still pending. Without this a retry armed
      // just before sign-out keeps firing, finds no session, and re-arms itself
      // every 5s for the life of the process — and the next sign-in starts a
      // second chain on top of it.
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      subscription?.unsubscribe()
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [user?.id, familyId])

  const stopService = async () => {
    if (!Capacitor.isNativePlatform()) return
    try {
      await LocationService.stop()
      if (refreshTimer.current) clearInterval(refreshTimer.current)
      console.log('[LocationService] Stopped')
    } catch (e) {}
  }

  return { stopService }
}
