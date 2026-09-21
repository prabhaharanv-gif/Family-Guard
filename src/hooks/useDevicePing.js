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
import { App as CapApp } from '@capacitor/app'
import { supabase } from '../lib/supabase'
import { stopNativePing, isNativePingRinging } from '../lib/nativePing'

/**
 * Tracks whether the native ring is sounding, so the app can offer a way to
 * silence it.
 *
 * The ring is started by FCM, not by JS, so the app cannot know it is happening
 * by having caused it. It finds out three ways: by asking the service when it
 * opens (the phone was found and unlocked mid-ring), by watching the same
 * device_pings insert the push came from (the app was already open), and by
 * asking again whenever the app comes back to the front — which is the case the
 * websocket misses, because a backgrounded WebView receives no realtime.
 *
 * Taking the control away again is the one job with no event behind it: the
 * service gives up after 30 seconds whether or not anyone silenced it, and a
 * Stop button left behind on a silent phone is its own small bug. That is what
 * the poll below is for — and why it runs ONLY while the phone is actually
 * ringing. It used to run every 2s for the entire life of the process, roughly
 * 43,000 bridge crossings a day to answer "no" every time, which showed up in
 * the CPU figures of the 2026-09-16 battery audit. Ringing is rare and bounded
 * to about 30 seconds, so this now costs essentially nothing while keeping the
 * control just as prompt to disappear.
 */
function useNativePingRinging(user) {
  const [ringing, setRinging] = useState(false)
  const pollRef = useRef(null)
  // Guards setState after teardown. A ref rather than a local, because `check`
  // is shared by the subscription effect and the poll effect below.
  const cancelledRef = useRef(false)

  const check = useCallback(async () => {
    const isRinging = await isNativePingRinging()
    if (!cancelledRef.current) setRinging(isRinging)
    return isRinging
  }, [])

  const stop = useCallback(async () => {
    await stopNativePing()
    setRinging(false)
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user) return

    cancelledRef.current = false

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

    // The usual case for this feature is a phone that was lost, so it was
    // almost certainly not in the foreground when the ring began: no realtime
    // arrived, and the check above ran long before the push did. Asking again
    // on resume is what reveals the control to someone who has just picked the
    // phone up.
    let resumeHandle = null
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) check()
    }).then((h) => {
      if (cancelledRef.current) h.remove()
      else resumeHandle = h
    }).catch(() => {})

    return () => {
      cancelledRef.current = true
      supabase.removeChannel(channel)
      resumeHandle?.remove()
    }
  }, [user, check])

  // Only while it is actually ringing: this exists to notice the ring ENDING,
  // which nothing else reports, and there is nothing to notice otherwise.
  useEffect(() => {
    if (!ringing) return

    pollRef.current = setInterval(check, 2000)
    return () => {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [ringing, check])

  return { ringing, stop }
}

/** Takes no family: a ping is addressed to the person (target_user_id). */
export function useDevicePing(user) {
  const native = useNativePingRinging(user)

  useEffect(() => {
    // Not gated on familyId: the filter below matches target_user_id, so a ping
    // from any family already arrives. See useCallSignaling for the same note.
    if (!user) return
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
  }, [user])

  return { pingRinging: native.ringing, stopPing: native.stop }
}
