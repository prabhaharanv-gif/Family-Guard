import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import OnboardingPage from './pages/OnboardingPage'
import FamilyPage from './pages/FamilyPage'
import MessagesPage from './pages/MessagesPage'
import SOSPage from './pages/SOSPage'
import MapAllPage from './pages/MapAllPage'
import MapPage from './pages/MapPage'
import AddMemberPage from './pages/AddMemberPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import Layout from './components/Layout'
import { useHeartbeat } from './hooks/useHeartbeat'

// Alarm sound for incoming SOS — loops until stopSOSAlarm() is called
let sosAlarmInterval = null
let sosAudioCtx = null

function playSOSAlarm() {
  // Stop any existing alarm first
  stopSOSAlarm()

  try {
    sosAudioCtx = new (window.AudioContext || window.webkitAudioContext)()

    const playOneCycle = () => {
      if (!sosAudioCtx) return
      const beepAt = (t, freq, dur) => {
        try {
          const osc = sosAudioCtx.createOscillator()
          const gain = sosAudioCtx.createGain()
          osc.connect(gain)
          gain.connect(sosAudioCtx.destination)
          osc.frequency.value = freq
          osc.type = 'square'
          gain.gain.setValueAtTime(0.4, sosAudioCtx.currentTime + t)
          gain.gain.exponentialRampToValueAtTime(0.001, sosAudioCtx.currentTime + t + dur)
          osc.start(sosAudioCtx.currentTime + t)
          osc.stop(sosAudioCtx.currentTime + t + dur)
        } catch(e) {}
      }
      // Two-tone urgent pattern: 880Hz + 660Hz
      const pattern = [0, 0.25, 0.5, 0.75, 1.0]
      pattern.forEach(t => beepAt(t, 880, 0.2))
      pattern.forEach(t => beepAt(t + 0.12, 660, 0.12))
    }

    playOneCycle()
    // Repeat every 1.5 seconds until stopped
    sosAlarmInterval = setInterval(playOneCycle, 1500)

    // Browser notification (one-time)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🆘 SOS Alert!', { body: 'A family member needs help NOW!' })
    }
  } catch(e) { console.warn('Alarm error:', e) }
}

function stopSOSAlarm() {
  if (sosAlarmInterval) {
    clearInterval(sosAlarmInterval)
    sosAlarmInterval = null
  }
  if (sosAudioCtx) {
    try { sosAudioCtx.close() } catch(e) {}
    sosAudioCtx = null
  }
}

// Global SOS alert overlay — works on ANY page
function GlobalSOSAlert({ alert, onDismiss }) {
  if (!alert) return null
  const memberName = alert._senderName || 'A family member'

  return (
    <div className="sos-blink-overlay" onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon">🆘</div>
        <div className="sos-alert-title">
          🚨 {memberName} Is In Trouble!
        </div>
        <div className="sos-alert-sub">
          {alert.message || 'SOS Alert'}
          {alert.lat !== 0 && alert.lat && (
            <>
              <br />
              <a
                href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
              >
                📍 View Location on Map
              </a>
            </>
          )}
        </div>
        <button className="sos-alert-dismiss" onClick={onDismiss}>
          ✋ I Understand — Dismiss
        </button>
      </div>
    </div>
  )
}

function PrivateRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="splash">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { initialize, user, familyId } = useAuthStore()
  const [sosAlert, setSosAlert] = useState(null)
  useEffect(() => { initialize() }, [])
  useHeartbeat(user?.id, familyId)

  // Global SOS listener — active on ALL pages
  useEffect(() => {
    if (!user || !familyId) return

    const channel = supabase
      .channel(`global-sos:${familyId}:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sos_alerts',
        filter: `family_id=eq.${familyId}`,
      }, async (payload) => {
        // Only show alert to OTHER family members, not the sender
        if (payload.new && payload.new.user_id !== user.id) {
          // Fetch the member name FIRST, then show alert so name is ready
          const { data } = await supabase
            .from('family_members')
            .select('display_name')
            .eq('user_id', payload.new.user_id)
            .limit(1)
            .single()
          const name = data?.display_name || 'A family member'
          setSosAlert({ ...payload.new, _senderName: name })
          playSOSAlarm()
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])

  return (
    <>
      <GlobalSOSAlert alert={sosAlert} onDismiss={() => { stopSOSAlarm(); setSosAlert(null) }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/onboarding" element={<PrivateRoute><OnboardingPage /></PrivateRoute>} />
        <Route path="/add-member" element={<PrivateRoute><AddMemberPage /></PrivateRoute>} />
        <Route path="/map/:userId" element={<PrivateRoute><MapPage /></PrivateRoute>} />

        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<FamilyPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="sos" element={<SOSPage />} />
          <Route path="map-all" element={<MapAllPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </>
  )
}
