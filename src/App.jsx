import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'

// Store
import { useAuthStore } from './store/authStore'
import { useSingleDevice } from './hooks/useSingleDevice'
import Dialog from './components/Dialog'
import { useT } from './i18n'

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
import { initSessionKeepAlive }  from './lib/sessionKeepAlive'

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

// ── Pages ────────────────────────────────────────────────────────────────────
//
// Split by how urgently the screen is needed, not by size.
//
// Eager, on purpose:
//   SOSPage     — a panic screen must never wait on a chunk to load. This is
//                 the one route where a spinner is an unacceptable answer, so
//                 it stays in the first bundle whatever it costs.
//   LoginPage   — the first paint for anyone signed out.
//   FamilyPage  — the first paint for everyone else.
//
// Everything else loads on demand. The big wins are CallPage, which is the only
// importer of lib/agora and therefore of the whole Agora RTC SDK, and the two
// map screens, which are the only importers of leaflet.
import LoginPage  from './pages/LoginPage'
import FamilyPage from './pages/FamilyPage'
import SOSPage    from './pages/SOSPage'

const RegisterPage      = lazy(() => import('./pages/RegisterPage'))
const OnboardingPage    = lazy(() => import('./pages/OnboardingPage'))
const JoinFamilyPage    = lazy(() => import('./pages/JoinFamilyPage'))
const CreateFamilyPage  = lazy(() => import('./pages/CreateFamilyPage'))
const MessagesPage      = lazy(() => import('./pages/MessagesPage'))
const MapAllPage        = lazy(() => import('./pages/MapAllPage'))
const MapPage           = lazy(() => import('./pages/MapPage'))
const CallPage          = lazy(() => import('./pages/CallPage'))
const AddMemberPage     = lazy(() => import('./pages/AddMemberPage'))
const SettingsPage      = lazy(() => import('./pages/SettingsPage'))
const ProfilePage       = lazy(() => import('./pages/ProfilePage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const DeleteAccountPage = lazy(() => import('./pages/DeleteAccountPage'))
const UserManualPage    = lazy(() => import('./pages/UserManualPage'))

export default function App() {
  const { initialize, user, familyId, loading, signOut } = useAuthStore()
  const location = useLocation()
  const navigate  = useNavigate()

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    initialize()
    // Refresh the access token whenever the app comes back to the
    // foreground. A backgrounded WebView freezes the library's own 30s
    // refresh ticker, and Android does not reliably fire the document
    // visibilitychange the library listens for, so without this the token
    // simply lapses after an hour and every request starts failing.
    initSessionKeepAlive()
  }, [])

  // ── Always-on services ───────────────────────────────────────────────────
  useHeartbeat(user?.id, familyId)
  usePushNotifications(user?.id, familyId)
  const { disclosureOpen, acceptDisclosure, declineDisclosure } = useLocationService()
  useLocationBroadcast(user?.id, familyId)
  const { pingRinging, stopPing } = useDevicePing(user, familyId)

  // ── One account, one device ──────────────────────────────────────────────
  // The newest sign-in owns the session; this device signs itself out when it
  // is displaced. Deliberately fails open — a failed check never signs anyone
  // out, because being locked out of a safety app is its own hazard.
  const t = useT()
  const [displaced, setDisplaced] = useState(false)
  useSingleDevice(user, () => setDisplaced(true))

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
      {/* Find My Phone. Someone hunting a ringing phone picks it up and opens
          the app; until this existed the only way to stop the noise was the
          action on its notification. */}
      <NativeAlarmBanner
        visible={pingRinging}
        onStop={stopPing}
        text="📡 Find My Phone is ringing"
        label="🔕 Silence"
      />
      {/* Web only. On Android SOSAlertActivity is the SOS screen in all three
          states — app open, app closed, screen locked — because it is the only
          one that can appear over a lock screen. Rendering this as well put two
          full-screen warnings on top of each other, each with its own
          "I Understand", so dismissing one revealed the other. */}
      <GlobalSOSAlert
        alert={Capacitor.isNativePlatform() ? null : sosAlert}
        onDismiss={stopAllAlarms}
      />
      {/* Web only, for the same reason as GlobalSOSAlert above: on Android
          CallRingingActivity is the incoming-call screen in all three states —
          app open, app closed, screen locked — because it is the only one that
          can appear over a lock screen. Rendering this as well put a banner and
          a card on screen for one call, each with its own Accept.

          CallPage renders its own ringing/accept UI once you're on it — showing
          this overlay too meant answering a call needed two taps on two
          stacked screens. */}
      <GlobalIncomingCall
        call={(!Capacitor.isNativePlatform() && !location.pathname.startsWith('/call/'))
          ? incomingCall : null}
        onAccept={handleAcceptCall}
        onDecline={declineIncoming}
      />
      {displaced && (
        <Dialog
          type="alert"
          title={t('session.displacedTitle')}
          message={t('session.displacedBody')}
          confirmLabel={t('session.signInAgain')}
          onClose={async () => {
            setDisplaced(false)
            await signOut()
            navigate('/login')
          }}
        />
      )}

      {/* Only once they are signed in AND in a family.
          Mounted unconditionally, this met people on the login screen — a
          brand-new install asking for autostart and overlay permissions before
          the person had an account, let alone seen what the app does. Nothing
          it asks for can matter until there is a family to receive an SOS from,
          and by then the app has earned the question. */}
      {user && familyId && <SosReliabilitySetup />}
      <BackgroundLocationDisclosure
        open={disclosureOpen}
        onAccept={acceptDisclosure}
        onDecline={declineDisclosure}
      />

      {/* Chunks are packaged inside the APK, so on device this resolves in
          milliseconds; the fallback is really for the web build. Deliberately
          blank rather than a spinner — a flash of spinner on every navigation
          reads as slower than a brief nothing. */}
      <Suspense fallback={null}>
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
      </Suspense>
    </ConsentGate>
  )
}
