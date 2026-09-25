import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const LIMITS = [60, 80, 100, 120]
const DEFAULT_LIMIT = 80

/**
 * Profile → Safety → Overspeed alert.
 *
 * Off unless the member turns it on, and the limit is their own choice — the
 * same rule as Shake for SOS: something that tells the whole family about how
 * a person drives must be opted into by that person. The setting lives in
 * user_alert_prefs (a null limit means off) because the detection runs on the
 * server, in a trigger on the locations table.
 */
export default function OverspeedAlertCard({ Toggle }) {
  const t = useT()
  const userId = useAuthStore(s => s.user?.id)
  const [limit, setLimit] = useState(undefined)   // undefined = loading, null = off

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase.from('user_alert_prefs').select('overspeed_limit_kmh').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setLimit(data?.overspeed_limit_kmh ?? null) })
      .catch(() => { if (alive) setLimit(null) })
    return () => { alive = false }
  }, [userId])

  if (limit === undefined) return null

  const save = async (next) => {
    const prev = limit
    setLimit(next)
    const { error } = await supabase.from('user_alert_prefs')
      .upsert({ user_id: userId, overspeed_limit_kmh: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) setLimit(prev)
  }

  const on = limit != null

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('overspeed.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('overspeed.subtitle')}
          </div>
        </div>
        <Toggle on={on} onToggle={() => save(on ? null : DEFAULT_LIMIT)} />
      </div>

      {on && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {LIMITS.map(v => {
            const sel = v === limit
            return (
              <button key={v} onClick={() => save(v)} style={{
                flex: '1 1 0', minWidth: 60, padding: '9px 6px', borderRadius: 12,
                fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                background: sel ? 'var(--maroon)' : 'var(--maroon-wash)',
                color: sel ? '#fff' : 'var(--maroon)',
                border: sel ? '1.5px solid var(--maroon)' : '1.5px solid #F0D8E3',
              }}>
                {v} km/h
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
