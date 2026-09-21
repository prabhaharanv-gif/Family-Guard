/**
 * useSosAlarm
 *
 * Manages the full SOS alarm lifecycle:
 *   - Listens for SOS inserts on the family's sos_alerts table
 *   - Plays the in-app Web Audio alarm for other family members
 *   - Polls the native Android siren state (for when app is reopened)
 *   - Exposes sosAlert, nativeAlarmOn, and stopAllAlarms to the caller
 *
 * Extracted from App.jsx.
 */

import { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { playSOSAlarm, stopSOSAlarm } from '../lib/sosAudio'
import { stopNativeSOSAlarm, isNativeSOSAlarmPlaying, triggerNativeSOSAlert, exitSosSilence } from '../lib/nativeSosAlarm'

/**
 * Give the ringer back once none of this user's own SOS alerts is open, in any
 * family (a gesture SOS can go to all of them at once). A failed query decides
 * nothing: leaving someone who may be hiding silent a little longer is the
 * safer mistake, and SosSilence expires on its own regardless.
 */
async function releaseSosSilenceIfClear(userId) {
  if (!Capacitor.isNativePlatform() || !userId) return
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('is_resolved', false)
    .limit(1)
  if (error) return
  if (!data?.length) exitSosSilence()
}
import { pushCloser, removeCloser } from '../lib/backHandler'

/**
 * @param familyIds every family the member belongs to, not just the active one.
 *   An SOS is the one thing that must arrive whichever family the app happens
 *   to be showing: with a single filter, someone in two families heard nothing
 *   when the other family raised an alert while the app was open. (The push
 *   path never had this gap — a phone's token is registered for every family —
 *   so it only ever went wrong with the app in front of the person.)
 */
export function useSosAlarm(user, familyIds) {
  const [sosAlert,     setSosAlert]     = useState(null)
  const [nativeAlarmOn, setNativeAlarmOn] = useState(false)

  const stopAllAlarms = useCallback(() => {
    stopSOSAlarm()
    stopNativeSOSAlarm()
    setNativeAlarmOn(false)
    setSosAlert(null)
  }, [])

  // Poll native siren state — covers the case where a push fired the siren
  // while the app was closed and the user reopens it
  useEffect(() => {
    let cancelled = false
    let poll = null

    const check = async () => {
      const playing = await isNativeSOSAlarmPlaying()
      if (!cancelled) setNativeAlarmOn(playing)
    }

    const startPoll = () => { if (!poll) poll = setInterval(check, 3000) }
    const stopPoll  = () => { if (poll) { clearInterval(poll); poll = null } }

    // Poll only while the app is actually on screen. Backgrounded, this bridge
    // call could not tell us anything the resume check below doesn't already
    // catch — it just woke the WebView every 3s for the life of the process.
    // Foreground behaviour is unchanged: same 3s cadence, same instant check
    // on resume.
    const onVisible = () => {
      if (document.visibilityState === 'visible') { check(); startPoll() }
      else stopPoll()
    }

    check()
    if (document.visibilityState === 'visible') startPoll()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      stopPoll()
    }
  }, [])

  // Realtime SOS listener — active on ALL pages, for ALL of the member's
  // families. Joined into a string so the effect does not re-subscribe on every
  // render just because the array is a new object.
  const familyKey = Array.isArray(familyIds) ? [...familyIds].sort().join(',') : (familyIds || '')

  useEffect(() => {
    if (!user || !familyKey) return

    const ids = familyKey.split(',').filter(Boolean)

    const handleInsert = async (payload) => {
        if (payload.new && payload.new.user_id !== user.id) {
          const { data } = await supabase
            .from('family_members')
            .select('display_name, phone')
            .eq('user_id', payload.new.user_id)
            // Scoped to the family the SOS came from. display_name is per
            // family and genuinely differs between them, so an unscoped lookup
            // could name the sender as they are known in a different family.
            .eq('family_id', payload.new.family_id)
            .limit(1)
            .single()
          const name = data?.display_name || 'A family member'
          setSosAlert({ ...payload.new, _senderName: name })
          // Web Audio beeps are the WEB fallback only. On Android
          // triggerNativeSOSAlert() below starts SOSSirenService, whose
          // synthesized 600->1600Hz sweep plays on STREAM_ALARM at forced max
          // volume — running both meant two overlapping sirens. The native one
          // is kept because it is louder, wakes the screen, and is the same
          // service the killed-app push path uses.
          if (!Capacitor.isNativePlatform()) playSOSAlarm()
          // Wake the screen / show the full-screen alert. playSOSAlarm() is Web
          // Audio only and cannot turn the display on, so an SOS arriving over
          // this websocket used to make noise at a dark screen.
          triggerNativeSOSAlert({
            sender:  name,
            message: payload.new.message,
            lat:     payload.new.lat,
            lng:     payload.new.lng,
            phone:   data?.phone,
          })
        }
    }

    // The sender tapped "I'm safe now": stop making noise about an emergency
    // that is over. Previously nothing listened for this, so the siren ran
    // until every family member silenced it by hand.
    const handleResolve = (payload) => {
      if (payload.new?.is_resolved) stopAllAlarms()
      // This user's own SOS was resolved — possibly from another device. That
      // is them saying they are safe, so the ringer comes back, the same as
      // "I'm Safe" on the SOS page.
      if (payload.new?.is_resolved && payload.new.user_id === user.id) exitSosSilence()
    }

    // Also on start: a silence whose SOS was resolved while this app was not
    // listening (another device, or the process was dead) must not linger.
    releaseSosSilenceIfClear(user.id)

    // One channel per family rather than one filter: postgres_changes takes a
    // single equality filter, and a member is rarely in more than a few families.
    const channels = ids.map(id => supabase
      .channel(`global-sos:${id}:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'sos_alerts',
        filter: `family_id=eq.${id}`,
      }, handleInsert)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'sos_alerts',
        filter: `family_id=eq.${id}`,
      }, handleResolve)
      .subscribe())

    return () => channels.forEach(c => supabase.removeChannel(c))
  }, [user, familyKey, stopAllAlarms])

  // Let the hardware back button dismiss the SOS overlay
  useEffect(() => {
    if (!sosAlert && !nativeAlarmOn) return
    const id = pushCloser(() => stopAllAlarms())
    return () => removeCloser(id)
  }, [sosAlert, nativeAlarmOn, stopAllAlarms])

  return { sosAlert, nativeAlarmOn, stopAllAlarms }
}
