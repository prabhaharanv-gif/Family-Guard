import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const QUICK_MESSAGES = [
  { label: 'Need Money', icon: '💰', color: '#FF9500' },
  { label: 'Need Police Help', icon: '🚔', color: '#4F8EF7' },
  { label: 'Need Ambulance', icon: '🚑', color: '#FF3B30' },
  { label: 'Fire Around Me', icon: '🔥', color: '#FF6B00' },
  { label: 'Theft', icon: '🦹', color: '#8B008B' },
  { label: 'Under Violence', icon: '🆘', color: '#CC0000' },
  { label: 'Under Harassment', icon: '⚠️', color: '#FF3B30' },
  { label: 'General SOS', icon: '🆘', color: '#CC0000' },
]

function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.4, 0.8, 1.2, 1.6].forEach(t => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'square'
      gain.gain.setValueAtTime(0.3, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.35)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.35)
    })
  } catch {}
}

function sendNotification(body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('🚨 SOS Alert!', { body })
  }
}

export default function SOSPage() {
  const { user, familyId } = useAuthStore()
  const [activeTab, setActiveTab] = useState('send')
  const [alerts, setAlerts] = useState([])
  const [sending, setSending] = useState(false)
  const [sentMessage, setSentMessage] = useState(null)
  const [members, setMembers] = useState({})
  const prevAlertIds = useRef(new Set())

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

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
          if (p.new.user_id !== user?.id && !prevAlertIds.current.has(p.new.id)) {
            prevAlertIds.current.add(p.new.id)
            playAlarm()
            sendNotification(p.new.message)
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => setAlerts(prev => prev.map(a => a.id === p.new.id ? { ...a, ...p.new } : a)))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  const sendSOS = async (message) => {
    if (sending) return
    setSending(true)
    playAlarm()
    try {
      const pos = await new Promise((res) =>
        navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 5000 })
      )
      await supabase.from('sos_alerts').insert({
        user_id: user.id, family_id: familyId,
        lat: pos ? pos.coords.latitude : 0,
        lng: pos ? pos.coords.longitude : 0,
        message,
      })
      setSentMessage(message)
      setTimeout(() => setSentMessage(null), 4000)
    } finally {
      setSending(false)
    }
  }

  const resolveAlert = async (alertId) => {
    await supabase.from('sos_alerts').update({
      is_resolved: true, resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    }).eq('id', alertId)
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

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {[
          { key: 'send', label: '🆘 Send SOS' },
          { key: 'history', label: '📋 History' + (activeCount > 0 ? ' (' + activeCount + ')' : '') },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '12px 0', background: 'none', border: 'none',
            fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            color: activeTab === tab.key ? 'var(--red)' : 'var(--muted)',
            borderBottom: activeTab === tab.key ? '2.5px solid var(--red)' : '2.5px solid transparent',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* SEND TAB */}
      {activeTab === 'send' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, overflow: 'hidden' }}>
          {sentMessage && (
            <div style={{
              background: 'var(--green)', color: '#fff', borderRadius: 12,
              padding: '12px 16px', marginBottom: 12, textAlign: 'center', fontWeight: 700,
            }}>
              ✅ Alert sent: "{sentMessage}"
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1 }}>
            {QUICK_MESSAGES.map((msg) => (
              <button key={msg.label} onClick={() => sendSOS(msg.label)} disabled={sending}
                style={{
                  background: sending ? '#f5f5f5' : msg.color + '12',
                  border: '2px solid ' + (sending ? '#ddd' : msg.color),
                  borderRadius: 14, padding: '12px 8px',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 6, fontFamily: 'inherit',
                  boxShadow: sending ? 'none' : '0 2px 8px ' + msg.color + '20',
                }}>
                <span style={{ fontSize: 28 }}>{msg.icon}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, lineHeight: 1.3,
                  color: sending ? '#aaa' : msg.color, textAlign: 'center',
                }}>
                  {msg.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {alerts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-emoji">✅</div>
              <div className="empty-text">No alerts yet</div>
              <div className="empty-sub">Everyone is safe!</div>
            </div>
          ) : alerts.map(alert => {
            const member = members[alert.user_id]
            const isOwn = alert.user_id === user?.id
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
                      style={{ color: 'var(--blue)', fontWeight: 600 }}>View on Google Maps</a><br /></span>
                  )}
                  🕐 {new Date(alert.created_at).toLocaleString()}
                </div>
                {!alert.is_resolved && isOwn && (
                  <button className="resolve-btn" style={{ background: 'var(--blue)' }}
                    onClick={() => resolveAlert(alert.id)}>
                    I'm Safe Now ✅
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
