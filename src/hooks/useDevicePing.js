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

import { useEffect, useState, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { stopNativePing, isNativePingRinging } from '../lib/nativePing'

/**
 * Tracks whether the native ring is sounding, so the app can offer a way to
 * silence it.
 *
 * The ring is started by FCM, not by JS, so the app cannot know it is happening
 * by having caused it. It finds out two ways: by asking the service when it
 * opens (the phone was found and unlocked mid-ring), and by watching the same
 * device_pings insert the push came from (the app was already open). Polling
 * afterwards is what takes the control away again — the service gives up after
 * 30 seconds whether or not anyone silenced it, and a Stop button left behind
 * on a silent phone is its own small bug.
 */
function useNativePingRinging(user) {
  const [ringing, setRinging] = useState(false)
  const pollRef = useRef(null)

  const stop = useCallback(async () => {
    await stopNativePing()
    setRinging(false)
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user) return

    let cancelled = false

    const check = async () => {
      const isRinging = await isNativePingRinging()
      if (!cancelled) setRinging(isRinging)
      return isRinging
    }

    // The app may have been opened while it was already ringing.
    check()

    // The insert that produced the push also reaches us over the websocket
    // when the app is open. Do NOT ring here — PingRingService owns the sound,
    // and a second one would be out of sync with it. This only reveals the
    // control.
    const channel = supabase
      .channel(`device-ping-native:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'device_pings',
        filter: `target_user_id=eq.${user.id}`,
      }, () => { check() })
      .subscribe()

    pollRef.current = setInterval(check, 2000)

    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      supabase.removeChannel(channel)
    }
  }, [user])

  return { ringing, stop }
}

export function useDevicePing(user, familyId) {
  const native = useNativePingRinging(user)

  useEffect(() => {
    if (!user || !familyId) return
    if (Capacitor.isNativePlatform()) return   // PingRingService owns the sound

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
            new Notification('📡 Find My Phone', { body: 'Someone is looking for your device!' })
          } else if (Notification.permission === 'default') {
            // Never asked on this browser — request now rather than dropping
            // the alert. The sound above still plays either way.
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification('📡 Find My Phone', { body: 'Someone is looking for your device!' })
              }
            }).catch(() => {})
          }
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])

  return { pingRinging: native.ringing, stopPing: native.stop }
}
