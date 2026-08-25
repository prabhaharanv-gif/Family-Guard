import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'

const QUICK_MESSAGES = [
  { label: 'Need Ambulance',    icon: '🚑', color: '#FF3B30', call: '108' },
  { label: 'Need Police Help',  icon: '🚔', color: '#4F8EF7', call: '100' },
  { label: 'Fire Around Me',    icon: '🔥', color: '#FF6B00', call: '112' },
  { label: 'Under Violence',    icon: '🛑', color: '#CC0000', call: '100' },
  { label: 'Under Harassment',  icon: '⚠️', color: '#FF3B30', call: '100' },
  { label: 'Natural Disasters', icon: '🌪️', color: '#0891B2', call: '108' },
  { label: 'Theft',             icon: '🦹', color: '#8B008B', call: '100' },
  { label: 'Need Money',        icon: '💰', color: '#FF9500', call: null  },
]

// ── Looping alarm — keeps sounding until stopSenderAlarm() is called ──────────
let senderAlarmInterval = null
let senderAudioCtx = null

function startSenderAlarm() {
  stopSenderAlarm() // clear any previous
  try {
    senderAudioCtx = new (window.AudioContext || window.webkitAudioContext)()

    const playOneCycle = () => {
      if (!senderAudioCtx) return
      const beepAt = (t, freq, dur) => {
        try {
          const osc  = senderAudioCtx.createOscillator()
          const gain = senderAudioCtx.createGain()
          osc.connect(gain)
          gain.connect(senderAudioCtx.destination)
          osc.frequency.value = freq
          osc.type = 'square'
          gain.gain.setValueAtTime(0.35, senderAudioCtx.currentTime + t)
          gain.gain.exponentialRampToValueAtTime(0.001, senderAudioCtx.currentTime + t + dur)
          osc.start(senderAudioCtx.currentTime + t)
          osc.stop(senderAudioCtx.currentTime + t + dur)
        } catch (e) {}
      }
      // Urgent two-tone pattern
      ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t, 880, 0.2))
      ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t + 0.12, 660, 0.12))
    }

    playOneCycle()
    senderAlarmInterval = setInterval(playOneCycle, 1500)
  } catch (e) {
    console.warn('Sender alarm error:', e)
  }
}

function stopSenderAlarm() {
  if (senderAlarmInterval) { clearInterval(senderAlarmInterval); senderAlarmInterval = null }
  if (senderAudioCtx) { try { senderAudioCtx.close() } catch (e) {} senderAudioCtx = null }
}

function sendNotification(body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('🚨 SOS Alert!', { body })
  }
}

export default function SOSPage() {
  const { user, familyId } = useAuthStore()
  const [activeTab, setActiveTab] = useState('send')
  const [alerts, setAlerts]       = useState([])
  const [sending, setSending]     = useState(false)
  const [sentMessage, setSentMessage] = useState(null)
  const [members, setMembers]     = useState({})
  // Track whether the sender alarm is running so we can show a stop button
  const [alarmOn, setAlarmOn]     = useState(false)

  const prevAlertIds = useRef(new Set())

  // Stop the alarm when leaving the page
  useEffect(() => {
    return () => stopSenderAlarm()
  }, [])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Reusable loader for pull-to-refresh (members + alerts)
  const reloadAlerts = async () => {
    if (!familyId) return
    const [memRes, alertRes] = await Promise.all([
      supabase.from('family_members').select('user_id, display_name, avatar_color').eq('family_id', familyId),
      supabase.from('sos_alerts').select('*').eq('family_id', familyId).order('created_at', { ascending: false }),
    ])
    if (memRes.data) {
      const map = {}
      memRes.data.forEach(m => { map[m.user_id] = m })
      setMembers(map)
    }
    if (alertRes.data) {
      setAlerts(alertRes.data)
      alertRes.data.forEach(a => prevAlertIds.current.add(a.id))
    }
  }

  useEffect(() => {
    if (!familyId) return

    supabase.from('family_members').select('user_id, display_name, avatar_color')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(m => { map[m.user_id] = m })
          setMembers(map)
        }
      })

    supabase.from('sos_alerts').select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          setAlerts(data)
          data.forEach(a => prevAlertIds.current.add(a.id))
        }
      })

    const channel = supabase
      .channel('sos-page:' + familyId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => {
          setAlerts(prev => [p.new, ...prev])
          // Only play receiver alarm for OTHER members' SOS (own SOS handled by sendSOS)
          if (p.new.user_id !== user?.id && !prevAlertIds.current.has(p.new.id)) {
            prevAlertIds.current.add(p.new.id)
            startSenderAlarm()
            setAlarmOn(true)
            sendNotification(p.new.message)
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => setAlerts(prev => prev.map(a => a.id === p.new.id ? { ...a, ...p.new } : a)))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  const sendSOS = async (msg) => {
    if (sending) return
    setSending(true)

    // NOTE: The sender does NOT get their own alarm/siren. Only OTHER family
    // members are alerted (via FCM push + the realtime listener). The sender
    // just gets the quiet "Alert sent" confirmation below.

    if (msg.call) {
      window.open(`tel:${msg.call}`, '_system')
    }

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
      setSentMessage(msg.label)
      setTimeout(() => setSentMessage(null), 4000)
    } catch (e) {
      console.error('SOS send error:', e)
    } finally {
      setSending(false)
    }
  }

  const handleStopAlarm = () => {
    stopSenderAlarm()
    setAlarmOn(false)
  }

  const resolveAlert = async (alertId) => {
    const { error } = await supabase.rpc('resolve_sos', { p_sos_id: alertId })
    if (error) console.error('Resolve error:', error.code || 'unknown')
  }

  const activeCount = alerts.filter(a => !a.is_resolved).length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div className="top-bar">
        <div>
          <div className="top-bar-title">🆘 SOS Alerts</div>
          <div className="top-bar-sub">Tap once to alert your family instantly</div>
        </div>
      </div>

      {/* ── Alarm active banner — shown to SENDER while their alarm is sounding ── */}
      {alarmOn && (
        <div style={{
          background: 'linear-gradient(90deg, #CC0000, #FF3B30)',
          color: '#fff',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 10,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>🚨 Alert sent — alarm sounding</span>
          <button
            onClick={handleStopAlarm}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1.5px solid #fff',
              color: '#fff',
              borderRadius: 20,
              padding: '6px 14px',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            🔕 Stop Alarm
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #E8E5FF', flexShrink: 0 }}>
        {[
          { key: 'send',    label: '🆘 Send SOS' },
          { key: 'history', label: '📋 History' + (activeCount > 0 ? ' (' + activeCount + ')' : '') },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '12px 0', background: 'none', border: 'none',
            fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            color: activeTab === tab.key ? '#F43F5E' : '#8480B0',
            borderBottom: activeTab === tab.key ? '2.5px solid #F43F5E' : '2.5px solid transparent',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* SEND TAB */}
      {activeTab === 'send' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 12 }}>
          {sentMessage && (
            <div style={{
              background: 'linear-gradient(135deg, #10B981, #059669)',
              color: '#fff', borderRadius: 14,
              padding: '14px 16px', marginBottom: 12, textAlign: 'center',
              fontWeight: 700, fontSize: 14,
              boxShadow: '0 4px 16px rgba(16,185,129,0.35)',
            }}>
              ✅ Alert sent: "{sentMessage}"
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, gridAutoRows: '1fr' }}>
            {QUICK_MESSAGES.map((msg) => (
              <button
                key={msg.label}
                onClick={() => sendSOS(msg)}
                disabled={sending}
                style={{
                  background: sending ? '#f5f5f5' : msg.color + '10',
                  border: '2px solid ' + (sending ? '#E5E7EB' : msg.color + '60'),
                  borderRadius: 18, padding: '18px 10px',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, fontFamily: 'inherit',
                  boxShadow: sending ? 'none' : `0 4px 14px ${msg.color}18`,
                  position: 'relative', height: '100%',
                  transition: 'all 0.18s ease',
                }}
              >
                {/* Emergency call badge */}
                {msg.call && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: msg.color, borderRadius: 8,
                    padding: '2px 6px',
                    fontSize: 9, fontWeight: 800, color: '#fff',
                    letterSpacing: 0.3,
                  }}>
                    {msg.call}
                  </div>
                )}
                <span style={{ fontSize: 32, lineHeight: 1 }}>{msg.icon}</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, lineHeight: 1.3,
                  color: sending ? '#aaa' : msg.color,
                  textAlign: 'center', width: '100%',
                }}>
                  {msg.label}
                </span>
              </button>
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
                onClick={async () => {
                  if (!window.confirm(`Clear resolved alerts? This cannot be undone.`)) return
                  const { error } = await supabase.rpc('clear_sos_history', { p_family_id: familyId })
                  if (error) { alert('Error: ' + error.message); return }
                  setAlerts(prev => prev.filter(a => !a.is_resolved))
                }}
                style={{
                  background: '#FFF0F3', border: '1px solid #951345',
                  color: '#951345', borderRadius: 10,
                  padding: '7px 14px', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                🗑 Clear Resolved ({alerts.filter(a => a.is_resolved).length})
              </button>
            </div>
          )}

          {alerts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-emoji">✅</div>
              <div className="empty-text">No alerts yet</div>
              <div className="empty-sub">Everyone is safe!</div>
            </div>
          ) : alerts.map(alert => {
            const member = members[alert.user_id]
            const isOwn  = alert.user_id === user?.id
            return (
              <div key={alert.id} className={'alert-card' + (alert.is_resolved ? ' resolved' : '')}>
                <div className="alert-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: member?.avatar_color || '#4F8EF7',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 13,
                    }}>
                      {member?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="alert-name">{isOwn ? 'You' : member?.display_name || 'Family Member'}</span>
                  </div>
                  <span className={'badge ' + (alert.is_resolved ? 'badge-resolved' : 'badge-active')}>
                    {alert.is_resolved ? '✅ Safe' : '🚨 Active'}
                  </span>
                </div>
                <div className="alert-message" style={{ fontWeight: 600 }}>{alert.message}</div>
                <div className="alert-meta">
                  {alert.lat !== 0 && (
                    <span>📍 <a href={'https://www.google.com/maps?q=' + alert.lat + ',' + alert.lng}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: '#4F46E5', fontWeight: 600 }}>View on Google Maps</a><br /></span>
                  )}
                  🕐 {new Date(alert.created_at).toLocaleString()}
                </div>
                {!alert.is_resolved && isOwn && (
                  <button
                    onClick={() => { resolveAlert(alert.id); handleStopAlarm() }}
                    style={{
                      marginTop: 14, width: '100%',
                      background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                      color: '#fff', border: 'none', borderRadius: 12,
                      padding: '12px 16px', fontWeight: 800,
                      fontFamily: 'inherit', cursor: 'pointer', fontSize: 14,
                      boxShadow: '0 4px 16px rgba(16,185,129,0.4)',
                      letterSpacing: 0.2,
                    }}
                  >
                    ✅ I'm Safe Now
                  </button>
                )}
              </div>
            )
          })}
        </div>
        </PullToRefresh>
      )}
    </div>
  )
}
