/**
 * useDevicePing
 *
 * Listens for device_pings targeted at the current user and rings this device
 * so its owner can locate it.
 *
 * WEB ONLY. On native Android the ring is owned by PingRingService, started
 * from the FCM `type: "ping"` data message in MyFirebaseMessagingService —
 * that path works whether the app is foregrounded, backgrounded or killed, and
 * plays on the alarm stream so it is audible on a silenced phone. Data-only
 * FCM messages reach onMessageReceived() in the foreground too, so running
 * this hook on native as well would ring the phone twice, out of sync.
 *
 * Extracted from App.jsx.
 */

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'

export function useDevicePing(user, familyId) {
  useEffect(() => {
    if (!user || !familyId) return
    if (Capacitor.isNativePlatform()) return   // PingRingService owns this

    const channel = supabase
      .channel(`device-ping:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'device_pings',
        filter: `target_user_id=eq.${user.id}`,
      }, () => {
        // An AudioContext created without a prior user gesture starts
        // SUSPENDED under the browser autoplay policy, and osc.start() on a
        // suspended context is silently dropped. resume() is what actually
        // makes this audible; it resolves once the page has had any gesture,
        // which by this point it has (the user signed in).
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          const beep = () => {
            let t = 0
            for (let i = 0; i < 10; i++) {
              const osc  = ctx.createOscillator()
              const gain = ctx.createGain()
              osc.connect(gain)
              gain.connect(ctx.destination)
              osc.frequency.value = i % 2 === 0 ? 1000 : 700
              osc.type = 'square'
              gain.gain.setValueAtTime(0.6, ctx.currentTime + t)
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3)
              osc.start(ctx.currentTime + t)
              osc.stop(ctx.currentTime + t + 0.3)
              t += 0.35
            }
          }
          if (ctx.state === 'suspended') ctx.resume().then(beep).catch(() => {})
          else beep()
        } catch (e) {}

        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('📡 Find My Device', { body: 'Someone is looking for your device!' })
          } else if (Notification.permission === 'default') {
            // Never asked on this browser — request now rather than dropping
            // the alert. The sound above still plays either way.
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification('📡 Find My Device', { body: 'Someone is looking for your device!' })
              }
            }).catch(() => {})
          }
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])
}
