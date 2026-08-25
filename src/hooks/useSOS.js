import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useSOS(familyId, userId) {
  const [alerts, setAlerts] = useState([])
  const [activeAlert, setActiveAlert] = useState(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!familyId) return

    supabase
      .from('sos_alerts')
      .select('*')
      .eq('family_id', familyId)
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) { setAlerts(data); setActiveAlert(data[0] || null) }
      })

    const channel = supabase
      .channel(`sos:${familyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'sos_alerts',
        filter: `family_id=eq.${familyId}`,
      }, (p) => {
        setAlerts(prev => [p.new, ...prev])
        if (!p.new.is_resolved) setActiveAlert(p.new)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sos_alerts',
        filter: `family_id=eq.${familyId}`,
      }, (p) => {
        setAlerts(prev => prev.map(a => a.id === p.new.id ? { ...a, ...p.new } : a))
        if (p.new.is_resolved) setActiveAlert(null)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  // ── SECURE: uses send_sos RPC — user_id comes from auth.uid() server-side ──
  const sendSOS = useCallback(async (message = 'SOS! I need help!') => {
    if (!familyId || !userId) return
    setSending(true)
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true })
      )
      const { error } = await supabase.rpc('send_sos', {
        p_family_id: familyId,
        p_lat:       pos.coords.latitude,
        p_lng:       pos.coords.longitude,
        p_message:   message,
      })
      if (error) throw error
    } finally {
      setSending(false)
    }
  }, [familyId, userId])

  // ── SECURE: resolve_sos() RPC — only updates allowed fields server-side ──
  const resolveAlert = useCallback(async (alertId) => {
    const { error } = await supabase.rpc('resolve_sos', { p_sos_id: alertId })
    if (error) console.error('Resolve SOS error:', error.code || 'unknown')
  }, [])

  return { alerts, activeAlert, sending, sendSOS, resolveAlert }
}
