import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

/**
 * Profile → Safety → Weather alerts.
 *
 * One switch, on unless the member turns it off: these are warnings about
 * severe weather at their saved places, a safety feature, so silence has to be
 * a choice. The setting lives on the server (user_alert_prefs) because the
 * check that sends the alerts runs there; no row means on.
 */
export default function WeatherAlertsCard({ Toggle }) {
  const t = useT()
  const userId = useAuthStore(s => s.user?.id)
  const [on, setOn] = useState(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase.from('user_alert_prefs').select('weather_alerts').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setOn(data ? data.weather_alerts !== false : true) })
      .catch(() => { if (alive) setOn(true) })
    return () => { alive = false }
  }, [userId])

  if (on === null) return null

  const toggle = async () => {
    const next = !on
    setOn(next)
    const { error } = await supabase.from('user_alert_prefs')
      .upsert({ user_id: userId, weather_alerts: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) setOn(!next)
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('weatherAlerts.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('weatherAlerts.subtitle')}
          </div>
        </div>
        <Toggle on={on} onToggle={toggle} />
      </div>
    </div>
  )
}
