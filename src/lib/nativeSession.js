import { registerPlugin, Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { authLog } from './authDebug'

// Registered here and shared, rather than in each consumer: Capacitor warns
// on a second registerPlugin for the same name (it returns the same proxy, so
// it works either way, but the warning is noise on every launch).
export const LocationService = registerPlugin('LocationService')

/**
 * Adopt the session the native background service renewed while the app slept.
 *
 * Two things hold a copy of the Supabase session: the WebView (localStorage,
 * via supabase-js) and LocationForegroundService (SharedPreferences, so it can
 * keep posting locations with the app closed). Supabase rotates the refresh
 * token on every renewal — issuing a new one revokes the old.
 *
 * The service renews independently, roughly hourly, whenever a location push
 * comes back 401. It persists the new refresh token on its own side. Nothing
 * told the WebView. So the next time JS refreshes it presents a token the
 * server revoked hours ago, Supabase answers "Invalid Refresh Token: Already
 * Used", and supabase-js — correctly treating that as unrecoverable — erases
 * the session. The user opens the app and finds the login screen, with no
 * explanation, having done nothing wrong.
 *
 * JS already pushes its tokens down on every refresh (useLocationService), so
 * the native copy never goes stale that way. This is the missing return path.
 */
export async function adoptNativeSession(reason = 'unknown') {
  if (!Capacitor.isNativePlatform()) return false

  try {
    const tokens = await LocationService.getSessionTokens()
    const access = tokens?.sessionToken
    const refresh = tokens?.refreshToken
    if (!access || !refresh) return false

    // Already holding this exact session — nothing to adopt.
    const { data: { session: current } } = await supabase.auth.getSession()
    if (current?.refresh_token === refresh) return false

    const { data, error } = await supabase.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    })

    if (error) {
      // The native copy is no better than ours (both revoked, or the user
      // really did sign out). Leave the client alone and let the normal flow
      // decide — never sign anyone out from in here.
      authLog('native-adopt-rejected', { reason, error: error.message })
      return false
    }

    authLog('native-session-adopted', { reason, hasSession: !!data?.session })
    return !!data?.session
  } catch (e) {
    // Plugin missing (older build) or storage unreadable — not fatal.
    authLog('native-adopt-unavailable', { reason, error: e?.message })
    return false
  }
}
