/**
 * useCallSignaling
 *
 * Global "is someone calling me" listener — mounted once in App.jsx, active on
 * every page (mirrors useSosAlarm.js). Only handles INCOMING call detection +
 * ringing + accept/decline; starting an outgoing call and the live in-call UI
 * both live in CallPage.jsx / FamilyPage.jsx, called directly via RPC.
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { triggerNativeCallAlert, stopNativeCallAlarm } from '../lib/nativeCallAlarm'

/**
 * What I call this person on their family card, if I have renamed them there.
 *
 * Read here rather than through useNicknames: this hook feeds the full-screen
 * incoming-call alert, which is often built before any screen that would have
 * loaded the shared map — and one row is a cheaper thing to fetch than a race
 * to have the map ready in time.
 */
async function nicknameFor(familyId, ownerUserId, targetUserId) {
  if (!familyId || !ownerUserId || !targetUserId) return ''
  const { data } = await supabase
    .from('member_nicknames')
    .select('nickname')
    .eq('family_id',      familyId)
    .eq('owner_user_id',  ownerUserId)
    .eq('target_user_id', targetUserId)
    .maybeSingle()
  return (data?.nickname || '').trim()
}

/**
 * Incoming-call signalling. Takes no family: a call is addressed to the person
 * (callee_id), so this listens across every family they belong to.
 */
export function useCallSignaling(user) {
  const [incomingCall, setIncomingCall] = useState(null) // { ...call row, callerName }

  const dismiss = useCallback(() => {
    setIncomingCall(null)
    stopNativeCallAlarm()
  }, [])

  // ── Discover an already-ringing call ─────────────────────────────────────
  // The realtime INSERT below only fires for calls that arrive while the app
  // is running. Answering from a notification is the opposite case: the call
  // row already exists before the app starts, so there is no INSERT to catch
  // and the accept UI never appeared — which is why tapping the notification
  // silenced the ring and left no way to answer.
  //
  // Asking the DB directly makes answering independent of how the app was
  // opened (notification tap, cold start, or the user just unlocking), rather
  // than depending on intent extras surviving a cold start.
  const checkForRingingCall = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('callee_id', user.id)
      .eq('status', 'ringing')
      .order('started_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) return
    const call = data[0]

    // Ignore stale rows: the caller gives up at 45s, so anything older than
    // that is a call that already rang out and must not resurrect the UI.
    if (Date.now() - new Date(call.started_at).getTime() > 60000) return

    const [{ data: member }, nickname] = await Promise.all([
      supabase
        .from('family_members')
        .select('display_name, avatar_url')
        .eq('user_id', call.caller_id)
        .eq('family_id', call.family_id)
        .maybeSingle(),
      nicknameFor(call.family_id, user.id, call.caller_id),
    ])

    setIncomingCall(prev => prev && prev.id === call.id
      ? prev
      : {
        ...call,
        callerName: nickname || member?.display_name || 'A family member',
        callerAvatar: member?.avatar_url || '',
      })
  }, [user])

  useEffect(() => {
    if (!user) return
    checkForRingingCall()

    // Re-check whenever the app comes back to the foreground — covers being
    // woken by the notification and unlocking the phone afterwards.
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForRingingCall()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [user, checkForRingingCall])

  useEffect(() => {
    // Deliberately not gated on familyId. Both filters below match on
    // callee_id, so this already covers a call from ANY of the member's
    // families; requiring an active family only meant no subscription at all
    // while the family list was still loading, or between families.
    if (!user) return

    const channel = supabase
      .channel(`global-calls:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'calls',
        filter: `callee_id=eq.${user.id}`,
      }, async (payload) => {
        const call = payload.new
        if (!call || call.status !== 'ringing') return

        const [{ data }, nickname] = await Promise.all([
          supabase
            .from('family_members')
            .select('display_name, avatar_url')
            .eq('user_id', call.caller_id)
            .eq('family_id', call.family_id)
            .maybeSingle(),
          nicknameFor(call.family_id, user.id, call.caller_id),
        ])

        const callerName = nickname || data?.display_name || 'A family member'
        const callerAvatar = data?.avatar_url || ''
        setIncomingCall({ ...call, callerName, callerAvatar })
        triggerNativeCallAlert({ callId: call.id, callerName, callerAvatar, callType: call.call_type })
      })
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'calls',
        filter: `callee_id=eq.${user.id}`,
      }, (payload) => {
        const call = payload.new
        if (!call) return
        // The ringing call got resolved elsewhere (timed out, answered from a
        // different surface) — clear the overlay and stop the native ring.
        setIncomingCall(prev => (prev && prev.id === call.id && call.status !== 'ringing') ? null : prev)
        if (call.status !== 'ringing') stopNativeCallAlarm()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user])

  const acceptIncoming = useCallback(async () => {
    if (!incomingCall) return null
    const callId = incomingCall.id
    const { error } = await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'accept' })
    dismiss()
    if (error) { console.warn('[useCallSignaling] accept failed:', error.message); return null }
    return callId
  }, [incomingCall, dismiss])

  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return
    const callId = incomingCall.id
    dismiss()
    const { error } = await supabase.rpc('respond_to_call', { p_call_id: callId, p_action: 'decline' })
    if (error) console.warn('[useCallSignaling] decline failed:', error.message)
  }, [incomingCall, dismiss])

  return { incomingCall, acceptIncoming, declineIncoming, dismissIncoming: dismiss }
}
