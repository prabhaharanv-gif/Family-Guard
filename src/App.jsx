import { useEffect, useRef } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'

// Store
import { useAuthStore } from './store/authStore'

// Hooks
import { usePushNotifications }  from './hooks/usePushNotifications'
import { useLocationService }    from './hooks/useLocationService'
import { useLocationBroadcast }  from './hooks/useLocationBroadcast'
import { useHeartbeat }          from './hooks/useHeartbeat'
import { useSosAlarm }           from './hooks/useSosAlarm'
import { useCallSignaling }      from './hooks/useCallSignaling'
import { useUnreadMessages }     from './hooks/useUnreadMessages'
import { useDevicePing }         from './hooks/useDevicePing'
import { initBackHandler }       from './lib/backHandler'

// Components
import ConsentGate         from './components/ConsentGate'
import PrivateRoute        from './components/PrivateRoute'
import NativeAlarmBanner   from './components/NativeAlarmBanner'
import { Capacitor }       from '@capacitor/core'
import GlobalSOSAlert      from './components/GlobalSOSAlert'
import GlobalIncomingCall  from './components/GlobalIncomingCall'
import SosReliabilitySetup from './components/SosReliabilitySetup'
import BackgroundLocationDisclosure from './components/BackgroundLocationDisclosure'
import Layout              from './components/Layout'

// Pages
import LoginPage        from './pages/LoginPage'
import RegisterPage     from './pages/RegisterPage'
import OnboardingPage   from './pages/OnboardingPage'
import JoinFamilyPage   from './pages/JoinFamilyPage'
import CreateFamilyPage from './pages/CreateFamilyPage'
import FamilyPage       from './pages/FamilyPage'
import MessagesPage     from './pages/MessagesPage'
import SOSPage          from './pages/SOSPage'
import MapAllPage       from './pages/MapAllPage'
import MapPage          from './pages/MapPage'
import CallPage         from './pages/CallPage'
import AddMemberPage    from './pages/AddMemberPage'
import SettingsPage     from './pages/SettingsPage'
import ProfilePage      from './pages/ProfilePage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import DeleteAccountPage  from './pages/DeleteAccountPage'
import UserManualPage    from './pages/UserManualPage'

export default function App() {
  const { initialize, user, familyId, loading } = useAuthStore()
  const location = useLocation()
  const navigate  = useNavigate()

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => { initialize() }, [])

  // ── Always-on services ───────────────────────────────────────────────────
  useHeartbeat(user?.id, familyId)
  usePushNotifications(user?.id, familyId)
  const { disclosureOpen, acceptDisclosure, declineDisclosure } = useLocationService()
  useLocationBroadcast(user?.id, familyId)
  useDevicePing(user, familyId)

  // ── SOS alarm + unread badge ─────────────────────────────────────────────
  const { sosAlert, nativeAlarmOn, stopAllAlarms } = useSosAlarm(user, familyId)
  const { unreadMessages } = useUnreadMessages(user, familyId)

  // ── Incoming call signaling ───────────────────────────────────────────────
  const { incomingCall, acceptIncoming, declineIncoming } = useCallSignaling(user, familyId)
  const handleAcceptCall = async () => {
    const callId = await acceptIncoming()
    if (callId) navigate(`/call/${callId}`)
  }

  // ── Expose global navigator for native deep-links (e.g. tap → /messages) ─
  useEffect(() => {
    window.__navigateTo = (path) => navigate(path)
    return () => { delete window.__navigateTo }
  }, [navigate])

  // Native deep-links (answering a call from a notification) fire during a
  // COLD start, when __navigateTo already exists but the Supabase session has
  // not been restored yet. Navigating then hits PrivateRoute's
  // `<Navigate to="/login" replace />`, which REPLACES the call route — so the
  // call screen was destroyed before it ever rendered and the call rang out.
  // Native/JS deep-link handlers wait for this flag instead of just for the
  // router.
  useEffect(() => {
    window.__authReady = !loading && !!user
    return () => { delete window.__authReady }
  }, [loading, user])

  // ── Android hardware back button ─────────────────────────────────────────
  const pathRef = useRef(location.pathname)
  useEffect(() => { pathRef.current = location.pathname }, [location.pathname])

  useEffect(() => {
    const ROOT_TABS = ['/', '/messages', '/sos', '/map-all', '/profile', '/settings']
    initBackHandler(
      () => ROOT_TABS.includes(pathRef.current),
      () => navigate(-1),
    )
  }, [navigate])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <ConsentGate>
      <NativeAlarmBanner visible={nativeAlarmOn} onStop={stopAllAlarms} />
      {/* Web only. On Android SOSAlertActivity is the SOS screen in all three
          states — app open, app closed, screen locked — because it is the only
          one that can appear over a lock screen. Rendering this as well put two
          full-screen warnings on top of each other, each with its own
          "I Understand", so dismissing one revealed the other. */}
      <GlobalSOSAlert
        alert={Capacitor.isNativePlatform() ? null : sosAlert}
        onDismiss={stopAllAlarms}
      />
      {/* CallPage renders its own ringing/accept UI once you're on it — showing
          this overlay too meant answering a call needed two taps on two
          stacked screens. */}
      <GlobalIncomingCall
        call={!location.pathname.startsWith('/call/') ? incomingCall : null}
        onAccept={handleAcceptCall}
        onDecline={declineIncoming}
      />
      <SosReliabilitySetup />
      <BackgroundLocationDisclosure
        open={disclosureOpen}
        onAccept={acceptDisclosure}
        onDecline={declineDisclosure}
      />

      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/privacy"  element={<PrivacyPolicyPage />} />
        {/* Public, and deliberately outside PrivateRoute: Play requires a
            deletion route reachable by someone who has uninstalled the app. */}
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route path="/manual"   element={<UserManualPage />} />

        <Route path="/onboarding" element={<PrivateRoute><OnboardingPage /></PrivateRoute>} />
        <Route path="/add-member" element={<PrivateRoute><AddMemberPage /></PrivateRoute>} />
        <Route path="/join-family"   element={<PrivateRoute><JoinFamilyPage /></PrivateRoute>} />
        <Route path="/create-family" element={<PrivateRoute><CreateFamilyPage /></PrivateRoute>} />
        <Route path="/map/:userId"   element={<PrivateRoute><MapPage /></PrivateRoute>} />
        <Route path="/call/:callId"  element={<PrivateRoute><CallPage /></PrivateRoute>} />

        <Route path="/" element={<PrivateRoute><Layout unreadMessages={unreadMessages} /></PrivateRoute>}>
          <Route index         element={<FamilyPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="sos"      element={<SOSPage />} />
          <Route path="map-all"  element={<MapAllPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile"  element={<ProfilePage />} />
        </Route>
      </Routes>
    </ConsentGate>
  )
}
