import { useState, useEffect, useRef } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'
import { useT } from '../i18n'

// ── SVG Icon components — consistent outlined style ───────────────────────────
const Icons = {
  Ambulance: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l2-4h10l2 4"/><rect x="1" y="9" width="20" height="11" rx="2"/>
      <path d="M16 20a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/><path d="M4 20a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/>
      <path d="M10 11v4M8 13h4"/>
    </svg>
  ),
  Police: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  ),
  Fire: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 0-5 5-5 10a5 5 0 0 0 10 0c0-3-2-5-2-5s0 2-2 2c-1 0-1.5-1-1.5-2S12 2 12 2z"/>
      <path d="M10 16.5a2 2 0 0 0 4 0c0-1.5-2-2.5-2-2.5s-2 1-2 2.5z"/>
    </svg>
  ),
  Violence: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="15" r="1" fill="currentColor"/>
    </svg>
  ),
  Harassment: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>
  ),
  Disaster: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 16.9A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
      <polyline points="13 11 9 17 15 17 11 23"/>
    </svg>
  ),
  Theft: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
    </svg>
  ),
  Money: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
}

// Call-number badge backgrounds — same maroon family, distinct shade per emergency number
const CALL_BADGE_BG = { '100': '#6B0B2C', '108': '#951345', '112': '#C0185A' }

// `label` is the English text stored in sos_alerts.message and read by the
// send-sos-notification function. It stays English deliberately: one alert is
// read by a whole family, who may not share a language, and changing it would
// orphan every row already in the table. `key` is what the UI translates.
/* i18n-exempt:start — `label` is written to sos_alerts.message and read by
   the notification function, so it stays English on purpose; `key` is what
   the UI translates. */
const QUICK_MESSAGES = [
  { key: 'police',     label: 'Need Police Help',  Icon: Icons.Police,      color: '#720D35', bg: '#F5EBF0', call: '100', emergency: true  },
  { key: 'violence',   label: 'Under Violence',    Icon: Icons.Violence,    color: '#8A0F3A', bg: '#F8ECF1', call: '100', emergency: true  },
  { key: 'harassment', label: 'Under Harassment',  Icon: Icons.Harassment,  color: '#C0185A', bg: '#FEF0F6', call: '100', emergency: true  },
  { key: 'ambulance',  label: 'Need Ambulance',    Icon: Icons.Ambulance,   color: '#951345', bg: '#FDF0F5', call: '108', emergency: true  },
  { key: 'disaster',   label: 'Natural Disaster',  Icon: Icons.Disaster,    color: '#6B0B2C', bg: '#F2E8EC', call: '108', emergency: true  },
  { key: 'fire',       label: 'Fire Around Me',    Icon: Icons.Fire,        color: '#B01650', bg: '#FDF2F6', call: '112', emergency: true  },
  { key: 'theft',      label: 'Theft',             Icon: Icons.Theft,       color: '#A01040', bg: '#FAF0F4', call: '100', emergency: false },
  { key: 'money',      label: 'Need Money',        Icon: Icons.Money,       color: '#951345', bg: '#FDF0F5', call: null,  emergency: false },
]
/* i18n-exempt:end */

// Stored English label → translation key, so a history row written before the
// language switch (or by a relative using English) still shows translated.
const LABEL_TO_KEY = Object.fromEntries(QUICK_MESSAGES.map(m => [m.label, m.key]))
const translateReason = (t, stored) =>
  LABEL_TO_KEY[stored] ? t('sos.msg.' + LABEL_TO_KEY[stored]) : stored

// ── Alarm — factory returns start/stop bound to private refs ─────────────────
// Using a factory instead of module-level variables prevents stale audio context
// leaks when the component unmounts and remounts (e.g. tab switching).
function createSenderAlarm() {
  let intervalId = null
  let audioCtx = null

  function start() {
    stop()
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const playOneCycle = () => {
        if (!audioCtx) return
        const beepAt = (t, freq, dur) => {
          try {
            const osc = audioCtx.createOscillator()
            const gain = audioCtx.createGain()
            osc.connect(gain); gain.connect(audioCtx.destination)
            osc.frequency.value = freq; osc.type = 'square'
            gain.gain.setValueAtTime(0.35, audioCtx.currentTime + t)
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + dur)
            osc.start(audioCtx.currentTime + t)
            osc.stop(audioCtx.currentTime + t + dur)
          } catch (e) {}
        }
        ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t, 880, 0.2))
        ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t + 0.12, 660, 0.12))
      }
      playOneCycle()
      intervalId = setInterval(playOneCycle, 1500)
    } catch (e) {}
  }

  function stop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null }
    if (audioCtx) { try { audioCtx.close() } catch (e) {} audioCtx = null }
  }

  return { start, stop }
}

// ── Confirmation overlay ─────────────────────────────────────────────────────
function ConfirmSheet({ msg, onConfirm, onCancel }) {
  const t = useT()
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '24px 20px 36px' }}>
        <div className="popup-handle" />

        {/* Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: '0 auto 20px',
          background: `linear-gradient(135deg, ${msg.color}18, ${msg.color}08)`,
          border: `2px solid ${msg.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: msg.color,
        }}>
          <msg.Icon />
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            fontFamily: 'Sora, sans-serif', fontSize: 20, fontWeight: 900,
            color: '#0D0C1D', marginBottom: 8, letterSpacing: -0.4,
          }}>
            {t('sos.msg.' + msg.key)}
          </div>
          <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.5 }}>
            {msg.call ? t('sos.confirmBodyCall', { number: msg.call }) : t('sos.confirmBody')}
          </div>
        </div>

        {/* What happens */}
        <div style={{
          background: '#F8F7FF', borderRadius: 14, padding: '14px 16px',
          marginBottom: 24, border: '1px solid #EDE9FF',
        }}>
          {[
            { icon: '📍', text: t('sos.willShareLocation') },
            { icon: '🔔', text: t('sos.familyGetsAlert') },
            msg.call && { icon: '📞', text: t('sos.willCall', { number: msg.call }) },
          ].filter(Boolean).map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: i < 2 ? 10 : 0,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{item.text}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '14px', borderRadius: 14,
            background: '#F8F7FF', border: '1px solid #EDE9FF',
            color: '#6B7280', fontWeight: 700, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>{t('common.cancel')}</button>
          <button onClick={onConfirm} style={{
            flex: 2, padding: '14px', borderRadius: 14,
            background: `linear-gradient(135deg, ${msg.color}, ${msg.color}CC)`,
            border: 'none', color: '#fff', fontWeight: 800, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: `0 6px 20px ${msg.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12.7 19.79 19.79 0 0 1 1.61 4.18 2 2 0 0 1 3.59 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            {t('sos.sendNow')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sent screen ───────────────────────────────────────────────────────────────
function SOSSentScreen({ msg, onDismiss, onSafe }) {
  const t = useT()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'linear-gradient(160deg, #0E0308 0%, #2A0618 50%, #0E0308 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
    }}>
      {/* Pulsing ring */}
      <div style={{ position: 'relative', marginBottom: 32 }}>
        <div style={{
          width: 140, height: 140, borderRadius: '50%',
          border: `3px solid ${msg.color}`,
          position: 'absolute', inset: -20,
          animation: 'sos-ring 1.8s ease-out infinite',
          opacity: 0.4,
        }} />
        <div style={{
          width: 100, height: 100, borderRadius: '50%',
          background: `linear-gradient(135deg, ${msg.color}, ${msg.color}99)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
          boxShadow: `0 0 60px ${msg.color}60, 0 0 0 1px ${msg.color}50`,
          animation: 'sos-pulse-scale 1.8s ease-in-out infinite',
        }}>
          <msg.Icon />
        </div>
      </div>

      <style>{`
        @keyframes sos-ring { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes sos-pulse-scale { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      `}</style>

      {/* Title */}
      <div style={{
        fontFamily: 'Sora, sans-serif', fontSize: 28, fontWeight: 900,
        color: '#fff', marginBottom: 8, letterSpacing: -0.5,
      }}>🚨 {t('sos.sentTitle')}</div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', marginBottom: 32, fontWeight: 500, lineHeight: 1.5, textAlign: 'center' }}>
        {t('sos.msg.' + msg.key)}
      </div>

      {/* Status cards */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        {[
          { icon: '📍', label: t('sos.locationShared'), ok: true },
          { icon: '🔔', label: t('sos.familyAlerted'), ok: true },
          { icon: '⏱️', label: t('sos.activeFor', { time: fmt(elapsed) }), ok: true },
        ].map((item, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 14, padding: '13px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <span style={{ fontSize: 14, color: '#fff', fontWeight: 600, flex: 1 }}>{item.label}</span>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: '#10B981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </div>
        ))}
      </div>

      {/* I'm Safe button */}
      <button onClick={onSafe} style={{
        width: '100%', padding: '16px', borderRadius: 18,
        background: 'linear-gradient(135deg, #10B981, #059669)',
        border: 'none', color: '#fff',
        fontFamily: 'Sora, sans-serif', fontWeight: 800, fontSize: 17,
        cursor: 'pointer', marginBottom: 14,
        boxShadow: '0 8px 28px rgba(16,185,129,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <polyline points="9 12 11 14 15 10"/>
        </svg>
        {t('sos.imSafe')}
      </button>

      <button onClick={onDismiss} style={{
        background: 'none', border: 'none',
        color: 'rgba(255,255,255,0.45)', fontSize: 13,
        fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
      }}>
        {t('sos.dismiss')}
      </button>
    </div>
  )
}

export default function SOSPage() {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const [activeTab, setActiveTab]       = useState('send')
  const [alerts, setAlerts]             = useState([])
  const [sending, setSending]           = useState(false)
  const [members, setMembers]           = useState({})
  const [alarmOn, setAlarmOn]           = useState(false)
  const [confirmMsg, setConfirmMsg]     = useState(null)  // msg waiting for confirm
  const [sentMsg, setSentMsg]           = useState(null)  // msg successfully sent → show sent screen
  const [dialog, setDialog]             = useState(null)

  const prevAlertIds = useRef(new Set())
  const alarmRef     = useRef(null)

  // Create alarm instance once per component mount; destroy on unmount
  useEffect(() => {
    alarmRef.current = createSenderAlarm()
    return () => alarmRef.current?.stop()
  }, [])

  const reloadAlerts = async () => {
    if (!familyId) return
    const [memRes, alertRes] = await Promise.all([
      supabase.from('family_members').select('user_id, display_name, avatar_color').eq('family_id', familyId),
      supabase.from('sos_alerts').select('*').eq('family_id', familyId).order('created_at', { ascending: false }),
    ])
    if (memRes.data) { const m = {}; memRes.data.forEach(x => { m[x.user_id] = x }); setMembers(m) }
    if (alertRes.data) setAlerts(alertRes.data)
  }

  useEffect(() => {
    if (!familyId) return
    reloadAlerts()

    const channel = supabase.channel(`sos:${familyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => {
          setAlerts(prev => [p.new, ...prev])
          if (p.new.user_id !== user?.id && !prevAlertIds.current.has(p.new.id)) {
            prevAlertIds.current.add(p.new.id)
            // Web only. On Android SOSSirenService already plays the siren and
            // SOSAlertActivity already shows the alert, so starting this too
            // gave a second, different-sounding alarm plus a banner the user had
            // to stop separately after dealing with the native one.
            if (!Capacitor.isNativePlatform()) { alarmRef.current?.start(); setAlarmOn(true) }
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => setAlerts(prev => prev.map(a => a.id === p.new.id ? { ...a, ...p.new } : a)))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  // ── Step 1: User taps a button → show confirm sheet
  const handleTap = (msg) => {
    if (sending) return
    setConfirmMsg(msg)
  }

  // ── Step 2: User confirms → send SOS → show sent screen
  const sendSOS = async () => {
    const msg = confirmMsg
    setConfirmMsg(null)
    setSending(true)

    if (msg.call) window.open(`tel:${msg.call}`, '_system')

    try {
      // Use Capacitor Geolocation on native (same as MapPage / LocationBroadcast).
      // navigator.geolocation falls back to network/IP on Android WebView and can
      // be several km off — Capacitor calls the native GPS API directly.
      let lat = 0, lng = 0
      try {
        if (Capacitor.isNativePlatform()) {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true, timeout: 8000, maximumAge: 30000,
          })
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        } else {
          // Web fallback
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
          )
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        }
      } catch (gpsErr) {
        console.warn('[SOS] GPS unavailable, sending with 0,0:', gpsErr?.message)
      }

      const { error: sosErr } = await supabase.rpc('send_sos', {
        p_family_id: familyId,
        p_lat:       lat,
        p_lng:       lng,
        p_message:   msg.label,
      })
      if (sosErr) throw sosErr
      setSentMsg(msg)  // show the sent screen
    } catch (e) {
      console.error('SOS send error:', e)
    } finally {
      setSending(false)
    }
  }

  // ── Step 3: "I'm Safe" → resolve latest alert + dismiss sent screen
  const handleSafe = async () => {
    const myLatest = alerts.find(a => a.user_id === user?.id && !a.is_resolved)
    if (myLatest) await supabase.rpc('resolve_sos', { p_sos_id: myLatest.id })
    setSentMsg(null)
  }

  const resolveAlert = async (alertId) => {
    const { error } = await supabase.rpc('resolve_sos', { p_sos_id: alertId })
    if (error) console.error('Resolve error:', error.code || 'unknown')
  }

  const activeCount = alerts.filter(a => !a.is_resolved).length

  const emergencyMsgs = QUICK_MESSAGES.filter(m => m.emergency)
  const otherMsgs     = QUICK_MESSAGES.filter(m => !m.emergency)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Sent screen — full screen takeover */}
      {sentMsg && (
        <SOSSentScreen
          msg={sentMsg}
          onSafe={handleSafe}
          onDismiss={() => setSentMsg(null)}
        />
      )}

      {/* Confirm sheet */}
      {confirmMsg && (
        <ConfirmSheet
          msg={confirmMsg}
          onConfirm={sendSOS}
          onCancel={() => setConfirmMsg(null)}
        />
      )}

      <div className="top-bar">
        <div>
          <div className="top-bar-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#fff"/>
            </svg>
            {t('sos.title')}
          </div>
        </div>

        {/* Clear Resolved — right side, matches Switch / Sign Out style */}
        {activeTab === 'history' && alerts.some(a => a.is_resolved) && (
          <button
            onClick={() => {
              setDialog({
                type: 'confirm',
                title: t('sos.clearTitle'),
                message: t('sos.clearMsg'),
                confirmLabel: t('sos.clear'),
                onConfirm: async () => {
                  const { error } = await supabase.rpc('clear_sos_history', { p_family_id: familyId })
                  if (error) {
                    setDialog({ type: 'error', title: t('sos.adminOnly'), message: t('sos.adminOnlyMsg') })
                    return
                  }
                  setAlerts(prev => prev.filter(a => !a.is_resolved))
                },
              })
            }}
            style={{
              background: 'rgba(255,255,255,0.92)',
              border: '1.5px solid #fff',
              color: '#951345',
              borderRadius: 10,
              padding: '7px 12px',
              fontWeight: 800,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
              zIndex: 1,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            {t('sos.clearResolved', { n: alerts.filter(a => a.is_resolved).length })}
          </button>
        )}
      </div>

      {/* Alarm active banner */}
      {alarmOn && (
        <div style={{
          background: 'linear-gradient(90deg, #951345, #B01650)',
          color: '#fff', padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: 10,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.5 }}>🚨 {t('sos.alarmBanner')}</span>
          <button onClick={() => { alarmRef.current?.stop(); setAlarmOn(false) }} style={{
            background: 'rgba(255,255,255,0.2)', border: '1.5px solid #fff',
            color: '#fff', borderRadius: 20, padding: '6px 14px',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>🔕 {t('sos.stop')}</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1.5px solid #F0E4EA', flexShrink: 0 }}>
        {[
          { key: 'send',    label: t('sos.tabSend') },
          { key: 'history', label: t('sos.tabHistory') + (activeCount > 0 ? ` (${activeCount})` : '') },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '13px 0', background: 'none', border: 'none',
            fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            color: activeTab === tab.key ? '#951345' : '#9C6B7A',
            borderBottom: activeTab === tab.key ? '2.5px solid #951345' : '2.5px solid transparent',
            transition: 'all 0.2s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* SEND TAB */}
      {activeTab === 'send' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ padding: '16px 14px' }}>

          {/* Emergency section */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.3, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#E11D48', animation: 'sos-pulse 1.5s ease-in-out infinite' }} />
            {t('sos.emergency')}
            <style>{`@keyframes sos-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }`}</style>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {emergencyMsgs.map((msg) => (
              <SOSButton key={msg.key} msg={msg} onTap={handleTap} disabled={sending} />
            ))}
          </div>

          {/* Other help section */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9C6B7A', letterSpacing: 0.3, marginBottom: 10 }}>
            {t('sos.otherHelp')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {otherMsgs.map((msg) => (
              <SOSButton key={msg.key} msg={msg} onTap={handleTap} disabled={sending} />
            ))}
          </div>

        </div>
        </PullToRefresh>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ padding: 16 }}>
          {alerts.length === 0 && (
            <div className="empty-state">
              <div style={{ margin: '0 auto 18px', width: 80, height: 80 }}>
                <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="80" height="80" rx="24" fill="#FDF0F5"/>
                  <path d="M40 12L16 22V40C16 54 26.4 67.2 40 70C53.6 67.2 64 54 64 40V22L40 12Z"
                    fill="url(#emptyShieldGrad)"/>
                  <path d="M40 16L20 25V40C20 52 28.8 63.6 40 66C51.2 63.6 60 52 60 40V25L40 16Z"
                    fill="none" stroke="rgba(232,201,106,0.6)" strokeWidth="1.5"/>
                  <path d="M32 40l5.5 5.5L50 33"
                    stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  <defs>
                    <linearGradient id="emptyShieldGrad" x1="16" y1="12" x2="64" y2="70" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#C0185A"/>
                      <stop offset="100%" stopColor="#4A0820"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="empty-text">{t('sos.allClear')}</div>
              <div className="empty-sub">{t('sos.noAlerts')}</div>
            </div>
          )}

          {alerts.map(alert => {
            const member = members[alert.user_id]
            const isOwn = alert.user_id === user?.id
            const d = new Date(alert.created_at)
            const now = new Date()
            const isToday = d.toDateString() === now.toDateString()
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
            const isYesterday = d.toDateString() === yesterday.toDateString()
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const dateStr = isToday ? t('sos.today', { time }) : isYesterday ? t('sos.yesterday', { time }) : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`

            return (
              <div key={alert.id} className={'alert-card' + (alert.is_resolved ? ' resolved' : '')} style={{ marginBottom: 12 }}>
                <div className="alert-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: member?.avatar_color || '#951345',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 14,
                    }}>
                      {(member?.display_name || 'F')?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div className="alert-name">{isOwn ? t('common.you') : member?.display_name || t('sos.family')}</div>
                      <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>{dateStr}</div>
                    </div>
                  </div>
                  <span className={'badge ' + (alert.is_resolved ? 'badge-resolved' : 'badge-active')}>
                    {alert.is_resolved ? '✅ ' + t('sos.safe') : '🚨 ' + t('sos.active')}
                  </span>
                </div>
                {alert.message && alert.message !== '0' && !(/^-?\d+(\.\d+)?$/.test(alert.message)) && (
                  <div className="alert-message">{translateReason(t, alert.message)}</div>
                )}
                {alert.lat && alert.lat !== 0 && (
                  <a href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 13, color: '#951345', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    {t('sos.viewOnMaps')}
                  </a>
                )}
                {!alert.is_resolved && isOwn && (
                  <button onClick={() => resolveAlert(alert.id)} className="resolve-btn">
                    ✅ {t('sos.markSafe')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        </PullToRefresh>
      )}

      {dialog && (
        <Dialog
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

// ── Individual SOS button ─────────────────────────────────────────────────────
function SOSButton({ msg, onTap, disabled }) {
  const t = useT()
  return (
    <button
      onClick={() => !disabled && onTap(msg)}
      disabled={disabled}
      style={{
        background: disabled ? '#F5F4FB' : msg.bg,
        border: `1.5px solid ${disabled ? '#E9E6FB' : msg.color + '40'}`,
        borderRadius: 18, padding: '18px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        gap: 10, fontFamily: 'inherit', height: '100%',
        boxShadow: disabled ? 'none' : `0 4px 16px ${msg.color}12`,
        position: 'relative',
        transition: 'all 0.18s ease',
      }}>
      {msg.call && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: CALL_BADGE_BG[msg.call] || msg.color, borderRadius: 8,
          padding: '2px 7px', fontSize: 9, fontWeight: 800,
          color: '#fff', letterSpacing: 0.3,
        }}>
          {msg.call}
        </div>
      )}
      <div style={{ color: disabled ? '#C0B8C8' : msg.color, marginTop: 4 }}>
        <msg.Icon />
      </div>
      <span style={{
        fontSize: 12, fontWeight: 700, lineHeight: 1.3,
        color: disabled ? '#C0B8C8' : msg.color,
        textAlign: 'center', width: '100%',
      }}>
        {t('sos.msg.' + msg.key)}
      </span>
    </button>
  )
}
