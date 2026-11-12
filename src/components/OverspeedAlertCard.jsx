import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import Icon from './Icon'

const LIMITS = [60, 80, 100, 120]
const DEFAULT_LIMIT = 80
// The database refuses anything outside this (user_alert_prefs check constraint).
const MIN_LIMIT = 30
const MAX_LIMIT = 200

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
  const [customOpen, setCustomOpen] = useState(false)
  const [customVal, setCustomVal]   = useState('')

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
  // A limit that is none of the presets was typed in: the Custom chip shows it.
  const isCustom = on && !LIMITS.includes(limit)
  const customNum = Number(customVal)
  const customOk = Number.isInteger(customNum) && customNum >= MIN_LIMIT && customNum <= MAX_LIMIT
  const saveCustom = () => {
    if (!customOk) return
    save(customNum)
    setCustomOpen(false)
  }
  const chip = (sel) => ({
    flex: '1 1 0', minWidth: 60, padding: '9px 6px', borderRadius: 12,
    fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer',
    background: sel ? 'var(--maroon)' : 'var(--maroon-wash)',
    color: sel ? '#fff' : 'var(--maroon)',
    border: sel ? '1.5px solid var(--maroon)' : '1.5px solid #F0D8E3',
  })

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
              <button key={v} onClick={() => { setCustomOpen(false); save(v) }} style={chip(sel)}>
                {v} km/h
              </button>
            )
          })}
          {/* The fifth choice: any limit from 30 to 200. Shows the typed number once set. */}
          <button
            onClick={() => { setCustomVal(isCustom ? String(limit) : ''); setCustomOpen(o => !o) }}
            aria-expanded={customOpen}
            style={{ ...chip(isCustom), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            <Icon name="pencil" size={13} />
            {isCustom ? `${limit} km/h` : t('overspeed.custom')}
          </button>
        </div>
      )}

      {on && customOpen && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              type="number" inputMode="numeric" min={MIN_LIMIT} max={MAX_LIMIT} step="1"
              autoFocus
              value={customVal}
              placeholder={`${MIN_LIMIT}–${MAX_LIMIT}`}
              aria-label={t('overspeed.custom')}
              onChange={e => setCustomVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveCustom() }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              onClick={saveCustom}
              disabled={!customOk}
              style={{
                background: 'var(--maroon)', border: '1.5px solid var(--maroon)', color: '#fff',
                borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
                cursor: customOk ? 'pointer' : 'default', opacity: customOk ? 1 : 0.5, flexShrink: 0,
              }}
            >
              {t('common.save')}
            </button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
            {t('overspeed.customHint')}
          </div>
        </div>
      )}
    </div>
  )
}
