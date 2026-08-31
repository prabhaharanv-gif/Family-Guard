/**
 * useSingleDevice
 *
 * Enforces one active device per account. The most recent sign-in claims the
 * session; any other device signs itself out as soon as it notices.
 *
 * Three ways a displaced device finds out, because none alone is sufficient:
 *   1. Realtime on user_active_device — instant while the app is foregrounded.
 *   2. On resume — realtime is not delivered to a sleeping WebView, so a phone
 *      that was in a pocket learns on the way back in.
 *   3. On mount — covers a cold start after the claim happened.
 *
 * The device id is a random per-install value in localStorage, not a hardware
 * identifier: Play restricts those, and all this has to do is tell one install
 * apart from another. Losing it (cleared data, reinstall) simply means the
 * device re-claims the session on next start, which is the same physical
 * device, so nothing user-visible happens.
 */

import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'

const DEVICE_KEY = 'famora_device_id'

/** Stable per-install id. Created once, then reused. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() || `d-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch (e) {
    // Private mode or storage disabled: fall back to a per-run id. The account
    // still works; it just re-claims on every launch, which is harmless.
    return `ephemeral-${Math.random().toString(36).slice(2)}`
  }
}

/** Something short and human for the "signed out" message on the other device. */
function deviceLabel() {
  const p = Capacitor.getPlatform()
  if (p === 'android') return 'Android app'
  if (p === 'ios') return 'iOS app'
  try {
    const ua = navigator.userAgent
    if (/Android/i.test(ua)) return 'Android browser'
    if (/iPhone|iPad/i.test(ua)) return 'iOS browser'
    if (/Windows/i.test(ua)) return 'Windows browser'
    if (/Mac/i.test(ua)) return 'Mac browser'
  } catch (e) {}
  return 'Web'
}

/**
 * @param {object|null} user      current auth user, or null when signed out
 * @param {() => void}  onDisplaced called when another device has taken over
 */
export function useSingleDevice(user, onDisplaced) {
  const deviceId = useRef(getDeviceId())
  // Guards against firing the sign-out twice when realtime and a resume check
  // land together.
  const displaced = useRef(false)
  // Kept in a ref so the effect below does not re-subscribe every time the
  // caller passes a fresh inline callback. Assigned in an effect, not during
  // render, which is what React expects of a mutable ref.
  const cbRef = useRef(onDisplaced)
  useEffect(() => { cbRef.current = onDisplaced }, [onDisplaced])

  useEffect(() => {
    if (!user) { displaced.current = false; return }

    const mine = deviceId.current
    let cancelled = false

    const displace = () => {
      if (cancelled || displaced.current) return
      displaced.current = true
      cbRef.current?.()
    }

    // Claim the session for this device, then verify. Claiming first is what
    // makes newest-wins work; verifying after covers the race where two
    // devices claim at nearly the same moment — the later write wins and the
    // earlier one sees it is no longer named.
    const claimAndVerify = async () => {
      try {
        const { error } = await supabase.rpc('claim_active_device', {
          p_device_id: mine,
          p_device_label: deviceLabel(),
        })
        if (error) {
          // Never sign someone out because the check itself failed — a network
          // blip must not lock a user out of a safety app.
          console.warn('[singleDevice] claim failed:', error.message)
        }
      } catch (e) {
        console.warn('[singleDevice] claim threw:', e?.message)
      }
    }

    const verify = async () => {
      try {
        const { data, error } = await supabase.rpc('is_active_device', { p_device_id: mine })
        if (error) return                 // same reasoning: fail open
        if (data === false) displace()
      } catch (e) { /* fail open */ }
    }

    claimAndVerify()

    // 1. Realtime — instant while foregrounded.
    const channel = supabase
      .channel(`active-device:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_active_device', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const claimed = payload.new?.device_id
          if (claimed && claimed !== mine) displace()
        })
      .subscribe()

    // 2. On resume — a backgrounded WebView receives no realtime.
    let resumeHandle
    if (Capacitor.isNativePlatform()) {
      resumeHandle = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) verify()
      })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') verify() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      resumeHandle?.then?.(h => h.remove())
      resumeHandle?.remove?.()
    }
  }, [user])
}
