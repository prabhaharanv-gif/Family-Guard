import { useEffect } from 'react'
import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'

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
      // Ensure we are authenticated first, otherwise the RPC rejects the save.
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

      // Retry a few times: covers the brief window where the session exists
      // client-side but auth.uid() is still settling, and transient errors.
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

    const listeners = []

    PushNotifications.addListener('registration', async ({ value: token }) => {
      // [removed sensitive log]
      await saveToken(token)
    }).then(l => listeners.push(l))

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[FCM] ❌ registrationError:', JSON.stringify(err))
    }).then(l => listeners.push(l))

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[FCM] Foreground notification:', JSON.stringify(notification))
      if (notification.data?.type === 'sos') {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          let t = 0
          for (let i = 0; i < 8; i++) {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = i % 2 === 0 ? 880 : 660
            osc.type = 'square'
            gain.gain.setValueAtTime(0.4, ctx.currentTime + t)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3)
            osc.start(ctx.currentTime + t)
            osc.stop(ctx.currentTime + t + 0.3)
            t += 0.35
          }
        } catch (e) {}
      }
    }).then(l => listeners.push(l))

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[FCM] Notification tapped')
      if (action.notification.data?.type === 'sos') {
        window.location.href = '/sos'
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
