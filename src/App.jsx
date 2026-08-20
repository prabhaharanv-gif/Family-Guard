import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
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
import Layout from './components/Layout'

function PrivateRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="splash">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { initialize } = useAuthStore()
  useEffect(() => { initialize() }, [])

  return (
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
      </Route>
    </Routes>
  )
}
