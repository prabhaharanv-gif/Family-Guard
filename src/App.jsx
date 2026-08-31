import { useEffect, useState, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { useAuthStore } from './store/authStore'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import OnboardingPage from './pages/OnboardingPage'
import JoinFamilyPage from './pages/JoinFamilyPage'
import CreateFamilyPage from './pages/CreateFamilyPage'
import FamilyPage from './pages/FamilyPage'
import MessagesPage from './pages/MessagesPage'
import SOSPage from './pages/SOSPage'
import MapAllPage from './pages/MapAllPage'
import MapPage from './pages/MapPage'
import AddMemberPage from './pages/AddMemberPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import { usePushNotifications } from './hooks/usePushNotifications'
import { useLocationService } from './hooks/useLocationService'
import { useLocationBroadcast } from './hooks/useLocationBroadcast'
import { useHeartbeat } from './hooks/useHeartbeat'
import { initBackHandler, pushCloser, removeCloser } from './lib/backHandler'
import { readMuteLevel } from './lib/muteLevel'
import Layout from './components/Layout'

// ── Native siren bridge (Android) ────────────────────────────────────────────
// The Java service plays the siren when the app is CLOSED. These call into it
// so the in-app button can silence it even when the app was opened from the
// launcher icon rather than by tapping the notification.
const SOSAlarm = registerPlugin('SOSAlarm')

async function stopNativeSOSAlarm() {
  if (!Capacitor.isNativePlatform()) return
  try { await SOSAlarm.stop() } catch (e) { console.warn('Native alarm stop failed:', e) }
}

async function isNativeSOSAlarmPlaying() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const res = await SOSAlarm.isPlaying()
    return !!res?.playing
  } catch (e) { return false }
}

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

// Shown when the NATIVE siren is still sounding (push arrived while app closed)
function NativeAlarmBanner({ visible, onStop }) {
  if (!visible) return null
  return (
    <div className="native-alarm-bar">
      <span className="native-alarm-text">🚨 SOS alarm is sounding</span>
      <button className="native-alarm-btn" onClick={onStop}>
        🔕 Stop Alarm
      </button>
    </div>
  )
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
          ✋ I Understand — Stop Alarm
        </button>
      </div>
    </div>
  )
}

// Condensed policy content reused inside ConsentGate's "Read Full Policy" view
function PolicyContent() {
  const sections = [
    { icon: '📋', title: 'What We Collect', color: '#4F46E5', items: ['Mobile number for account creation', 'Display name and optional profile photo', 'Real-time location (only when sharing is ON)', 'Messages within your family group', 'SOS alerts you send or receive', 'Device push notification token for alerts'] },
    { icon: '🔒', title: 'How We Use It', color: '#059669', items: ['Location shared only with your own family group', 'Messages visible only to your family members', 'Push tokens used only for SOS and message alerts', 'We never sell or share your data', 'We never read your messages'] },
    { icon: '🛡️', title: 'How We Protect It', color: '#7C3AED', items: ['Data stored on SOC 2 compliant Supabase servers', 'Row Level Security on all tables', 'Passwords bcrypt hashed — we cannot see them', 'All API calls require authentication'] },
    { icon: '🗑️', title: 'Data Retention', color: '#D97706', items: ['Messages are automatically deleted after 90 days', 'Resolved SOS alerts are deleted after 30 days', 'Only your current location is stored — no history is kept', 'Delete your account and all data anytime from Profile'] },
    { icon: '✅', title: 'Your Rights', color: '#16A34A', items: ['Turn off location sharing anytime in Profile → Privacy', 'Delete account and all data from Profile → Delete My Account', 'Leave any family group at any time'] },
  ]
  return (
    <div>
      {sections.map(s => (
        <div key={s.title} style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 10, border: '1px solid #F0EAF5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D' }}>{s.title}</span>
          </div>
          {s.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, marginTop: 6, flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5 }}>{item}</div>
            </div>
          ))}
        </div>
      ))}
      <div style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', textAlign: 'center', border: '1px solid #F0EAF5' }}>
        <div style={{ fontSize: 13, color: '#6B7280' }}>Questions? <a href="mailto:info@scoopinnovations.in" style={{ color: '#951345', fontWeight: 700 }}>info@scoopinnovations.in</a></div>
      </div>
    </div>
  )
}

function ConsentGate({ children }) {
  const { user, loading } = useAuthStore()
  const [agreed, setAgreed] = useState(() => {
    try { return localStorage.getItem('privacy_agreed') === '1' } catch { return false }
  })
  const [showPolicy, setShowPolicy] = useState(false)

  // Only gate authenticated users who haven't agreed yet
  if (loading) return <div className="splash">Loading...</div>
  if (!user) return children  // unauthenticated — let PrivateRoute handle redirect

  if (!agreed) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: '#F8F7FF',
        display: 'flex', flexDirection: 'column',
      }}>
        {showPolicy ? (
          // Full policy view — position fixed so it escapes app-shell overflow:hidden
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#F8F7FF', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              background: 'linear-gradient(135deg, #951345 0%, #720D35 100%)',
              padding: '16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            }}>
              <button onClick={() => setShowPolicy(false)} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, width: 36, height: 36, cursor: 'pointer',
                fontSize: 18, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>←</button>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'Sora, sans-serif' }}>Privacy Policy</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 0' }}>
              <PolicyContent />
              {/* Agree button inside scroll so it's always reachable */}
              <div style={{ padding: '20px 0 40px' }}>
                <button onClick={() => {
                  localStorage.setItem('privacy_agreed', '1')
                  setAgreed(true)
                }} style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg, #951345, #720D35)',
                  border: 'none', color: '#fff', fontWeight: 800,
                  fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(149,19,69,0.35)',
                }}>✅ I Agree — Continue to FamilyGuard</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>🛡️</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0D0C1D', marginBottom: 8, fontFamily: 'Sora, sans-serif' }}>
                Before You Continue
              </div>
              <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
                We've updated our Privacy Policy. Please review and accept it to continue using FamilyGuard.
              </div>
            </div>

            {/* Quick summary */}
            {[
              { icon: '📍', text: 'Your location is shared only with your own family group' },
              { icon: '💬', text: 'Messages are visible only to your family members' },
              { icon: '🔒', text: 'We never sell or share your data with anyone' },
              { icon: '🗑️', text: 'You can delete your account and all data anytime' },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: '#fff', borderRadius: 14, padding: '14px 16px',
                marginBottom: 10, border: '1px solid #F0EAF5',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>{item.text}</span>
              </div>
            ))}

            <button onClick={() => setShowPolicy(true)} style={{
              width: '100%', padding: '13px 16px', borderRadius: 14, marginTop: 6,
              background: '#F8F7FF', border: '1.5px solid #E9E6FB',
              color: '#951345', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer', marginBottom: 12,
            }}>
              📄 Read Full Privacy Policy
            </button>

            <button onClick={() => {
              localStorage.setItem('privacy_agreed', '1')
              setAgreed(true)
            }} style={{
              width: '100%', padding: 16, borderRadius: 16,
              background: 'linear-gradient(135deg, #951345, #720D35)',
              border: 'none', color: '#fff', fontWeight: 800,
              fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(149,19,69,0.35)',
            }}>
              ✅ I Agree — Continue
            </button>
          </div>
        )}
      </div>
    )
  }

  return children
}

function PrivateRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="splash">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { initialize, user, familyId } = useAuthStore()
  const [sosAlert, setSosAlert] = useState(null)
  const [nativeAlarmOn, setNativeAlarmOn] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const location = useLocation()
  const navigate  = useNavigate()
  useEffect(() => { initialize() }, [])
  useHeartbeat(user?.id, familyId)

  // Expose a global navigator so native code can deep-link into /messages
  useEffect(() => {
    window.__navigateTo = (path) => navigate(path)
    return () => { delete window.__navigateTo }
  }, [navigate])

  // ── Native Android hardware back button ──
  // Keep a live ref to the current path so the (once-registered) handler
  // always sees the latest route.
  const pathRef = useRef(location.pathname)
  useEffect(() => { pathRef.current = location.pathname }, [location.pathname])

  useEffect(() => {
    const ROOT_TABS = ['/', '/messages', '/sos', '/map-all', '/profile', '/settings']
    initBackHandler(
      () => ROOT_TABS.includes(pathRef.current),   // isRootRoute
      () => navigate(-1),                          // goBack
    )
  }, [navigate])

  // Clear unread badge whenever the user visits Messages
  useEffect(() => {
    if (location.pathname === '/messages') setUnreadMessages(0)
  }, [location.pathname])

  // Stops BOTH alarms: the in-app Web Audio one and the native siren
  const stopAllAlarms = useCallback(() => {
    stopSOSAlarm()
    stopNativeSOSAlarm()
    setNativeAlarmOn(false)
    setSosAlert(null)
  }, [])

  // If a push fired the native siren while the app was closed, show the stop
  // button as soon as the app is opened / brought back to the foreground.
  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const playing = await isNativeSOSAlarmPlaying()
      if (!cancelled) setNativeAlarmOn(playing)
    }

    check()

    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    // Poll while the banner is up so it disappears on the 60 s auto-timeout
    const poll = setInterval(check, 3000)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(poll)
    }
  }, [])

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

  // Unread message counter — increments when a message arrives from another member
  // and the user is NOT already on the Messages page
  useEffect(() => {
    if (!user || !familyId) return

    const msgChannel = supabase
      .channel(`unread-msgs:${familyId}:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (payload.new.user_id !== user.id &&
            window.location.pathname !== '/messages') {
          // Respect mute level — if fully muted (level 2) don't show badge either
          const muteLevel = readMuteLevel()
          if (muteLevel < 2) {
            setUnreadMessages(prev => prev + 1)
          }
        }
      })
      .subscribe()

    return () => supabase.removeChannel(msgChannel)
  }, [user, familyId])

  // Let the hardware back button dismiss the global SOS overlay
  useEffect(() => {
    if (!sosAlert && !nativeAlarmOn) return
    const id = pushCloser(() => stopAllAlarms())
    return () => removeCloser(id)
  }, [sosAlert, nativeAlarmOn, stopAllAlarms])

  usePushNotifications(user?.id, familyId)
  useLocationService() // Background GPS foreground service — keeps tracking when app killed (native only)
  useLocationBroadcast(user?.id, familyId) // Always-on writer — keeps pins fresh on web + native while app is open

  // Device ping listener — plays alarm when another member pings this device
  useEffect(() => {
    if (!user || !familyId) return

    const channel = supabase
      .channel(`device-ping:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'device_pings',
        filter: `target_user_id=eq.${user.id}`,
      }, () => {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          let t = 0
          for (let i = 0; i < 10; i++) {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = i % 2 === 0 ? 1000 : 700
            osc.type = 'square'
            gain.gain.setValueAtTime(0.6, ctx.currentTime + t)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3)
            osc.start(ctx.currentTime + t)
            osc.stop(ctx.currentTime + t + 0.3)
            t += 0.35
          }
        } catch (e) {}
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('📡 Find My Device', { body: 'Someone is looking for your device!' })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])

  return (
    <ConsentGate>
      <NativeAlarmBanner visible={nativeAlarmOn} onStop={stopAllAlarms} />
      <GlobalSOSAlert alert={sosAlert} onDismiss={stopAllAlarms} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/onboarding" element={<PrivateRoute><OnboardingPage /></PrivateRoute>} />
        <Route path="/add-member" element={<PrivateRoute><AddMemberPage /></PrivateRoute>} />
        <Route path="/join-family" element={<PrivateRoute><JoinFamilyPage /></PrivateRoute>} />
        <Route path="/create-family" element={<PrivateRoute><CreateFamilyPage /></PrivateRoute>} />
        <Route path="/map/:userId" element={<PrivateRoute><MapPage /></PrivateRoute>} />

        <Route path="/" element={<PrivateRoute><Layout unreadMessages={unreadMessages} /></PrivateRoute>}>
          <Route index element={<FamilyPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="sos" element={<SOSPage />} />
          <Route path="map-all" element={<MapAllPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </ConsentGate>
  )
}
