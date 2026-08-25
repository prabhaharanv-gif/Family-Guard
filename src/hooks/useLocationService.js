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

    const startService = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          console.warn('[LocationService] No session token — retrying in 5s')
          setTimeout(startService, 5000)
          return
        }

        tokenRef.current = session.access_token

        await LocationService.start({
          supabaseUrl:  SUPABASE_URL,
          supabaseKey:  SUPABASE_KEY,
          userId:       user.id,
          familyId:     familyId,
          sessionToken: session.access_token,
        })

        console.log('[LocationService] ✅ Background service started')
      } catch (e) {
        console.warn('[LocationService] Failed to start:', e?.message)
        // Retry after 10 seconds if start fails
        setTimeout(startService, 10000)
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
          await LocationService.updateSessionToken({ sessionToken: session.access_token })
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
            await LocationService.updateSessionToken({ sessionToken: session.access_token })
            console.log('[LocationService] 🔄 Token updated on auth change:', event)
          } catch (e) {}
        }
      }
    )

    return () => {
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
