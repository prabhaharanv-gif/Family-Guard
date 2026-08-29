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
import { supabase } from '../lib/supabase'
import { playSOSAlarm, stopSOSAlarm } from '../lib/sosAudio'
import { stopNativeSOSAlarm, isNativeSOSAlarmPlaying, triggerNativeSOSAlert } from '../lib/nativeSosAlarm'
import { pushCloser, removeCloser } from '../lib/backHandler'

export function useSosAlarm(user, familyId) {
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

  // Realtime SOS listener — active on ALL pages
  useEffect(() => {
    if (!user || !familyId) return

    const channel = supabase
      .channel(`global-sos:${familyId}:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'sos_alerts',
        filter: `family_id=eq.${familyId}`,
      }, async (payload) => {
        if (payload.new && payload.new.user_id !== user.id) {
          const { data } = await supabase
            .from('family_members')
            .select('display_name')
            .eq('user_id', payload.new.user_id)
            .limit(1)
            .single()
          const name = data?.display_name || 'A family member'
          setSosAlert({ ...payload.new, _senderName: name })
          playSOSAlarm()
          // Wake the screen / show the full-screen alert. playSOSAlarm() is Web
          // Audio only and cannot turn the display on, so an SOS arriving over
          // this websocket used to make noise at a dark screen.
          triggerNativeSOSAlert({
            sender:  name,
            message: payload.new.message,
            lat:     payload.new.lat,
            lng:     payload.new.lng,
          })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])

  // Let the hardware back button dismiss the SOS overlay
  useEffect(() => {
    if (!sosAlert && !nativeAlarmOn) return
    const id = pushCloser(() => stopAllAlarms())
    return () => removeCloser(id)
  }, [sosAlert, nativeAlarmOn, stopAllAlarms])

  return { sosAlert, nativeAlarmOn, stopAllAlarms }
}
