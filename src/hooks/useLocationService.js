import { useEffect, useRef } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const LocationService = registerPlugin('LocationService')

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * useLocationService
 *
 * Starts the Android background location foreground service when the user
 * has location sharing enabled. Stops it when sharing is turned off or the
 * user signs out.
 *
 * This is separate from MapAllPage's watchPosition — that handles the
 * foreground (in-app) GPS updates. This service handles the KILLED-APP case.
 *
 * Usage: call once at app level inside App.jsx
 */
export function useLocationService() {
  const { user, familyId } = useAuthStore()
  const tokenRef = useRef(null)

  useEffect(() => {
    // Only runs on Android native — no-op on web/desktop
    if (!Capacitor.isNativePlatform()) return
    if (!user || !familyId) return

    const startService = async () => {
      try {
        // Get current session token for Supabase RPC auth
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        tokenRef.current = session.access_token

        await LocationService.start({
          supabaseUrl:  SUPABASE_URL,
          supabaseKey:  SUPABASE_KEY,
          userId:       user.id,
          familyId:     familyId,
          sessionToken: session.access_token,
        })

        console.log('[LocationService] Background service started')
      } catch (e) {
        console.warn('[LocationService] Failed to start:', e?.message)
      }
    }

    startService()

    // Keep session token fresh — Supabase auto-refreshes, we push update to service
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.access_token && session.access_token !== tokenRef.current) {
          tokenRef.current = session.access_token
          try {
            await LocationService.updateSessionToken({ sessionToken: session.access_token })
          } catch (e) {}
        }
      }
    )

    return () => {
      subscription?.unsubscribe()
      // Don't stop on unmount — service should persist even when component unmounts.
      // It's stopped explicitly when user signs out or disables location.
    }
  }, [user?.id, familyId])

  // Call this when user disables location sharing from Profile
  const stopService = async () => {
    if (!Capacitor.isNativePlatform()) return
    try {
      await LocationService.stop()
      console.log('[LocationService] Background service stopped')
    } catch (e) {}
  }

  return { stopService }
}
