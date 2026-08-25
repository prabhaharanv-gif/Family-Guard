import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useSOS } from '../hooks/useSOS'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'

export default function AlertsPage() {
  const { user, familyId } = useAuthStore()
  const { resolveAlert } = useSOS(familyId, user?.id)
  const [alerts, setAlerts] = useState([])
  const [clearing, setClearing] = useState(false)
  const [dialog, setDialog] = useState(null)

  const loadAlerts = async () => {
    if (!familyId) return
    const { data } = await supabase
      .from('sos_alerts')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
    if (data) setAlerts(data)
  }

  useEffect(() => { loadAlerts() }, [familyId])

  const handleClearHistory = () => {
    const resolved = alerts.filter(a => a.is_resolved)
    if (resolved.length === 0) {
      setDialog({ type: 'alert', title: 'Nothing to Clear', message: 'There are no resolved alerts to clear.' })
      return
    }
    setDialog({
      type: 'confirm',
      title: 'Clear Alert History',
      message: `This will permanently delete ${resolved.length} resolved alert${resolved.length > 1 ? 's' : ''}. This cannot be undone.`,
      confirmLabel: 'Clear',
      onConfirm: async () => {
        setClearing(true)
        const { error } = await supabase.rpc('clear_sos_history', { p_family_id: familyId })
        if (error) {
          setDialog({ type: 'error', title: 'Admin Only', message: 'Only a family Admin can clear alert history.' })
        } else {
          setAlerts(prev => prev.filter(a => !a.is_resolved))
        }
        setClearing(false)
      },
    })
  }

  const resolvedCount = alerts.filter(a => a.is_resolved).length

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 16px 14px', flexShrink: 0 }}>
        <h1 className="page-title" style={{ margin: 0 }}>SOS Alerts</h1>
        {resolvedCount > 0 && (
          <button onClick={handleClearHistory} disabled={clearing} style={{
            background: '#FFF0F3', border: '1px solid #951345',
            color: '#951345', borderRadius: 10,
            padding: '7px 12px', fontWeight: 700, fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {clearing ? '...' : `🗑 Clear History (${resolvedCount})`}
          </button>
        )}
      </div>

      <PullToRefresh onRefresh={loadAlerts}>
      <div style={{ padding: '0 16px 16px' }}>
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
      </PullToRefresh>

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
