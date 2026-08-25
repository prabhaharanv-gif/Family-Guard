import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'

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

const QUICK_MESSAGES = [
  { label: 'Need Ambulance',    Icon: Icons.Ambulance,   color: '#951345', bg: '#FDF0F5', call: '108', emergency: true  },
  { label: 'Need Police Help',  Icon: Icons.Police,      color: '#720D35', bg: '#F5EBF0', call: '100', emergency: true  },
  { label: 'Fire Around Me',    Icon: Icons.Fire,        color: '#B01650', bg: '#FDF2F6', call: '112', emergency: true  },
  { label: 'Under Violence',    Icon: Icons.Violence,    color: '#8A0F3A', bg: '#F8ECF1', call: '100', emergency: true  },
  { label: 'Under Harassment',  Icon: Icons.Harassment,  color: '#C0185A', bg: '#FEF0F6', call: '100', emergency: true  },
  { label: 'Natural Disaster',  Icon: Icons.Disaster,    color: '#6B0B2C', bg: '#F2E8EC', call: '108', emergency: true  },
  { label: 'Theft',             Icon: Icons.Theft,       color: '#A01040', bg: '#FAF0F4', call: '100', emergency: false },
  { label: 'Need Money',        Icon: Icons.Money,       color: '#951345', bg: '#FDF0F5', call: null,  emergency: false },
]

// ── Alarm ────────────────────────────────────────────────────────────────────
let senderAlarmInterval = null
let senderAudioCtx = null

function startSenderAlarm() {
  stopSenderAlarm()
  try {
    senderAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const playOneCycle = () => {
      if (!senderAudioCtx) return
      const beepAt = (t, freq, dur) => {
        try {
          const osc = senderAudioCtx.createOscillator()
          const gain = senderAudioCtx.createGain()
          osc.connect(gain); gain.connect(senderAudioCtx.destination)
          osc.frequency.value = freq; osc.type = 'square'
          gain.gain.setValueAtTime(0.35, senderAudioCtx.currentTime + t)
          gain.gain.exponentialRampToValueAtTime(0.001, senderAudioCtx.currentTime + t + dur)
          osc.start(senderAudioCtx.currentTime + t)
          osc.stop(senderAudioCtx.currentTime + t + dur)
        } catch (e) {}
      }
      ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t, 880, 0.2))
      ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t + 0.12, 660, 0.12))
    }
    playOneCycle()
    senderAlarmInterval = setInterval(playOneCycle, 1500)
  } catch (e) {}
}

function stopSenderAlarm() {
  if (senderAlarmInterval) { clearInterval(senderAlarmInterval); senderAlarmInterval = null }
  if (senderAudioCtx) { try { senderAudioCtx.close() } catch (e) {} senderAudioCtx = null }
}

// ── Confirmation overlay ─────────────────────────────────────────────────────
function ConfirmSheet({ msg, onConfirm, onCancel }) {
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
            {msg.label}
          </div>
          <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.5 }}>
            This will immediately alert all your family members
            {msg.call && ` and call ${msg.call}`}.
          </div>
        </div>

        {/* What happens */}
        <div style={{
          background: '#F8F7FF', borderRadius: 14, padding: '14px 16px',
          marginBottom: 24, border: '1px solid #EDE9FF',
        }}>
          {[
            { icon: '📍', text: 'Your location will be shared' },
            { icon: '🔔', text: 'Family members get an emergency alert' },
            msg.call && { icon: '📞', text: `Emergency call to ${msg.call} will start` },
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
          }}>Cancel</button>
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
            Send SOS Now
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sent screen ───────────────────────────────────────────────────────────────
function SOSSentScreen({ msg, onDismiss, onSafe }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
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
      }}>🚨 SOS Sent</div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', marginBottom: 32, fontWeight: 500 }}>
        {msg.label}
      </div>

      {/* Status cards */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        {[
          { icon: '📍', label: 'Location shared', ok: true },
          { icon: '🔔', label: 'Family alerted', ok: true },
          { icon: '⏱️', label: `Alert active for ${fmt(elapsed)}`, ok: true },
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
        I'm Safe Now
      </button>

      <button onClick={onDismiss} style={{
        background: 'none', border: 'none',
        color: 'rgba(255,255,255,0.45)', fontSize: 13,
        fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
      }}>
        Dismiss
      </button>
    </div>
  )
}

export default function SOSPage() {
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

  useEffect(() => { return () => stopSenderAlarm() }, [])

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
            startSenderAlarm(); setAlarmOn(true)
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
      const pos = await new Promise((res) =>
        navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 5000 })
      )
      const { error: sosErr } = await supabase.rpc('send_sos', {
        p_family_id: familyId,
        p_lat:       pos ? pos.coords.latitude  : 0,
        p_lng:       pos ? pos.coords.longitude : 0,
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
            SOS Alerts
          </div>
          <div className="top-bar-sub">Tap to alert your family instantly</div>
        </div>
      </div>

      {/* Alarm active banner */}
      {alarmOn && (
        <div style={{
          background: 'linear-gradient(90deg, #951345, #B01650)',
          color: '#fff', padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: 10,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>🚨 Family alert received</span>
          <button onClick={() => { stopSenderAlarm(); setAlarmOn(false) }} style={{
            background: 'rgba(255,255,255,0.2)', border: '1.5px solid #fff',
            color: '#fff', borderRadius: 20, padding: '6px 14px',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>🔕 Stop</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1.5px solid #F0E4EA', flexShrink: 0 }}>
        {[
          { key: 'send',    label: 'Send SOS' },
          { key: 'history', label: `SOS History${activeCount > 0 ? ` (${activeCount})` : ''}` },
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
            Emergency
            <style>{`@keyframes sos-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }`}</style>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {emergencyMsgs.map((msg) => (
              <SOSButton key={msg.label} msg={msg} onTap={handleTap} disabled={sending} />
            ))}
          </div>

          {/* Other help section */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9C6B7A', letterSpacing: 0.3, marginBottom: 10 }}>
            Other Help
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {otherMsgs.map((msg) => (
              <SOSButton key={msg.label} msg={msg} onTap={handleTap} disabled={sending} />
            ))}
          </div>

        </div>
        </PullToRefresh>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ padding: 16 }}>
          {alerts.some(a => a.is_resolved) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                onClick={() => {
                  setDialog({
                    type: 'confirm',
                    title: 'Clear Resolved Alerts',
                    message: 'This will permanently delete all resolved SOS alerts for your family.',
                    confirmLabel: 'Clear',
                    onConfirm: async () => {
                      const { error } = await supabase.rpc('clear_sos_history', { p_family_id: familyId })
                      if (error) {
                        setDialog({ type: 'error', title: 'Admin Only', message: 'Only a family Admin can clear alert history.' })
                        return
                      }
                      setAlerts(prev => prev.filter(a => !a.is_resolved))
                    },
                  })
                }}
                style={{
                  background: '#FFF0F3', border: '1px solid #951345',
                  color: '#951345', borderRadius: 10,
                  padding: '7px 14px', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
                Clear Resolved ({alerts.filter(a => a.is_resolved).length})
              </button>
            </div>
          )}

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
              <div className="empty-text">All clear</div>
              <div className="empty-sub">No SOS alerts have been sent</div>
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
            const dateStr = isToday ? `Today ${time}` : isYesterday ? `Yesterday ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`

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
                      <div className="alert-name">{isOwn ? 'You' : member?.display_name || 'Family'}</div>
                      <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>{dateStr}</div>
                    </div>
                  </div>
                  <span className={'badge ' + (alert.is_resolved ? 'badge-resolved' : 'badge-active')}>
                    {alert.is_resolved ? '✅ Safe' : '🚨 Active'}
                  </span>
                </div>
                <div className="alert-message">{alert.message}</div>
                {alert.lat && alert.lat !== 0 && (
                  <a href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 13, color: '#951345', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    View on Google Maps
                  </a>
                )}
                {!alert.is_resolved && isOwn && (
                  <button onClick={() => resolveAlert(alert.id)} className="resolve-btn">
                    ✅ Mark as Safe
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
          background: msg.color, borderRadius: 8,
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
        {msg.label}
      </span>
    </button>
  )
}
