import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useSOS } from '../hooks/useSOS'

export default function AlertsPage() {
  const { user, familyId } = useAuthStore()
  const { resolveAlert } = useSOS(familyId, user?.id)
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (!familyId) return
    supabase
      .from('sos_alerts')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setAlerts(data) })
  }, [familyId])

  return (
    <div className="page">
      <h1 className="page-title">SOS Alerts</h1>

      {alerts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">✅</div>
          <div className="empty-text">No alerts — everyone is safe!</div>
        </div>
      ) : (
        alerts.map(alert => (
          <div key={alert.id} className={`alert-card ${alert.is_resolved ? 'resolved' : ''}`}>
            <div className="alert-header">
              <span className="alert-name">
                {alert.user_id === user?.id ? '👤 You' : '👤 Family Member'}
              </span>
              <span className={`badge ${alert.is_resolved ? 'badge-resolved' : 'badge-active'}`}>
                {alert.is_resolved ? '✅ Resolved' : '🚨 Active'}
              </span>
            </div>
            <div className="alert-message">{alert.message}</div>
            <div className="alert-meta">
              📍 {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}<br />
              🕐 {new Date(alert.created_at).toLocaleString()}
            </div>
            {!alert.is_resolved && alert.user_id !== user?.id && (
              <button className="resolve-btn" onClick={() => resolveAlert(alert.id)}>
                Mark as Safe ✅
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}
