import { useEffect } from 'react'
import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { playSOSAlarm } from '../lib/sosAudio'

export function usePushNotifications(userId, familyId) {
  useEffect(() => {
    if (!userId) return
    if (!Capacitor.isNativePlatform()) return

    let cancelled = false

    // Wait until the Supabase client actually has an authenticated session.
    // The FCM `registration` event can fire BEFORE the session is restored on
    // app launch; if we call the RPC then, auth.uid() is null server-side and
    // upsert_device_token raises "Not authenticated", silently losing the token.
    const waitForSession = async (maxTries = 20) => {
      for (let i = 0; i < maxTries; i++) {
        if (cancelled) return null
        const { data } = await supabase.auth.getSession()
        if (data?.session?.user?.id) return data.session
        await new Promise(r => setTimeout(r, 500)) // backoff, up to ~10s total
      }
      return null
    }

    // ── SECURE: uses upsert_device_token RPC ──────────────────────────────
    // user_id comes from auth.uid() server-side — the client cannot fake it
    const saveToken = async (token) => {
      const session = await waitForSession()
      if (!session) {
        console.warn('[FCM] No session after wait — token NOT saved')
        return
      }

      let fid = familyId
      if (!fid) {
        const { data } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('user_id', session.user.id)
          .limit(1)
          .single()
        fid = data?.family_id
      }
      if (!fid) {
        console.warn('[FCM] No familyId found, token NOT saved')
        return
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        const { error } = await supabase.rpc('upsert_device_token', {
          p_family_id: fid,
          p_token:     token,
          p_platform:  'android',
        })
        if (!error) { console.log('[FCM] Device registered'); return }
        console.error(`[FCM] Token save error (attempt ${attempt}):`, error.message || error)
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000))
      }
    }

    // ── Robust deep-link navigation ───────────────────────────────────────
    // When the app is opened by TAPPING an SOS notification from a killed
    // state, React Router may not be mounted yet at the moment the tap event
    // fires. window.__navigateTo (set in App.jsx) may also be undefined for a
    // moment. So we retry until the router is ready, then navigate to the
    // route carried in the notification's data payload (default /sos).
    const navigateWhenReady = (route, tries = 0) => {
      const target = route || '/sos'
      // __authReady (not just __navigateTo) — on a cold start from a
      // notification tap the router exists before the Supabase session is
      // restored, and navigating then hits PrivateRoute's
      // `<Navigate to="/login" replace />`, which replaces the target route
      // and loses it for good.
      if (typeof window !== 'undefined' && typeof window.__navigateTo === 'function' && window.__authReady) {
        window.__navigateTo(target)
        return
      }
      if (tries < 60) { // retry for up to ~12s
        setTimeout(() => navigateWhenReady(target, tries + 1), 200)
      } else {
        // Last-resort fallback — hard navigation
        try { window.location.href = target } catch (e) {}
      }
    }

    const listeners = []

    PushNotifications.addListener('registration', async ({ value: token }) => {
      await saveToken(token)
    }).then(l => listeners.push(l))

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[FCM] ❌ registrationError:', JSON.stringify(err))
    }).then(l => listeners.push(l))

    // Fired when a push arrives while the app is in the FOREGROUND.
    // Play the audio alarm AND navigate to /sos so the GlobalSOSAlert overlay
    // is shown. Previously only audio played — the visual alert was missing.
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      if (notification.data?.type === 'sos') {
        // Web only, same reason as the realtime path: MyFirebaseMessagingService
        // starts SOSSirenService for every "sos" push regardless of whether the
        // app is foreground (unlike the call branch, which does check), so the
        // native siren is already sounding by the time this runs.
        if (!Capacitor.isNativePlatform()) playSOSAlarm()
        navigateWhenReady(notification.data?.route || '/sos')
      }
    }).then(l => listeners.push(l))

    // Fired when the user TAPS the notification (works from killed/background).
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action?.notification?.data || {}
      if (data.type === 'sos') {
        navigateWhenReady(data.route || '/sos')
      } else if (data.type === 'call' && data.call_id) {
        // CallPage itself renders the right UI (ring/accept/live) based on the
        // call row's current status — no separate "answer from notification"
        // action needed, same as tapping into /sos just opens the SOS page.
        navigateWhenReady(`/call/${data.call_id}`)
      } else if (data.route) {
        navigateWhenReady(data.route)
      }
    }).then(l => listeners.push(l))

    const setup = async () => {
      try {
        let perm = await PushNotifications.checkPermissions()
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
          perm = await PushNotifications.requestPermissions()
        }
        if (perm.receive !== 'granted') {
          console.warn('[FCM] ❌ Permission denied')
          return
        }
        await PushNotifications.register()
      } catch (e) {
        console.error('[FCM] Setup error:', e)
      }
    }

    setup()

    return () => {
      cancelled = true
      listeners.forEach(l => { try { l.remove() } catch (e) {} })
    }
  }, [userId, familyId])
}
