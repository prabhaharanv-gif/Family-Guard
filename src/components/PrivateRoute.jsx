/**
 * PrivateRoute
 *
 * Redirects unauthenticated users to /login.
 * Shows a splash screen while auth state is loading.
 *
 * Extracted from App.jsx.
 */

import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="splash">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}
