import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useBackButton } from '../hooks/useBackButton'

/**
 * Profile → Safety → Driving trips.
 *
 * Off unless the member turns it on — the same rule as Overspeed alert and
 * Shake for SOS: a record of how somebody drives is shared with the whole
 * family, so that person has to choose it. Turning it off also deletes their
 * own trips. The trips themselves are built on the server, from the location
 * fixes the phone already sends (see the driving_trips migration).
 */

const MIN_DISTANCE_M = 500
const MIN_DURATION_S = 90

function fmtDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

function fmtWhen(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function TripsSheet({ onClose }) {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const [trips, setTrips] = useState(null)
  const [names, setNames] = useState({})
  useBackButton(true, onClose)

  useEffect(() => {
    if (!familyId) { setTrips([]); return }
    let alive = true
    ;(async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString()
      const [tr, mem, nick] = await Promise.all([
        supabase.from('trips').select('id, user_id, started_at, ended_at, distance_m, top_kmh, hard_brakes, hard_accels')
          .eq('family_id', familyId).gte('started_at', since).order('started_at', { ascending: false }).limit(60),
        supabase.from('family_members').select('user_id, display_name').eq('family_id', familyId),
        supabase.from('member_nicknames').select('target_user_id, nickname')
          .eq('family_id', familyId).eq('owner_user_id', user?.id || ''),
      ])
      if (!alive) return
      const map = {}
      for (const m of mem.data || []) map[m.user_id] = m.display_name
      for (const n of nick.data || []) if (n.nickname?.trim()) map[n.target_user_id] = n.nickname.trim()
      setNames(map)
      setTrips((tr.data || []).filter(x =>
        x.distance_m >= MIN_DISTANCE_M
        && (new Date(x.ended_at) - new Date(x.started_at)) / 1000 >= MIN_DURATION_S))
    })().catch(() => { if (alive) setTrips([]) })
    return () => { alive = false }
  }, [familyId, user?.id])

  // Portalled to the page root: the settings card it is opened from has a
  // transform/filter, which turns position:fixed into position:relative-to-card
  // and clipped this screen to a small window.
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', zIndex: 300 }}>
      <div style={{
        background: 'linear-gradient(135deg, var(--maroon) 0%, var(--maroon-deep) 100%)',
        padding: '16px 16px 14px', flexShrink: 0, boxShadow: '0 2px 12px rgba(139,13,61,0.25)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 10, width: 36, height: 36, cursor: 'pointer', fontSize: 18, color: '#fff',
        }}>←</button>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{t('trips.view')}</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {trips === null && <div style={{ color: 'var(--muted)', fontWeight: 600 }}>…</div>}
        {trips && trips.length === 0 && (
          <div style={{ color: 'var(--muted)', fontWeight: 600, textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
            {t('trips.empty')}
          </div>
        )}
        {(trips || []).map(x => {
          const sec = (new Date(x.ended_at) - new Date(x.started_at)) / 1000
          const km = x.distance_m / 1000
          const avg = sec > 0 ? Math.round(km / (sec / 3600)) : 0
          return (
            <div key={x.id} className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)' }}>{names[x.user_id] || '—'}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{fmtWhen(x.started_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 14, fontWeight: 700, color: 'var(--text)', flexWrap: 'wrap' }}>
                <span>{km.toFixed(1)} km</span>
                <span>{fmtDuration(sec)}</span>
                <span>{t('trips.avg')} {avg} km/h</span>
                <span>{t('trips.top')} {x.top_kmh} km/h</span>
              </div>
              {(x.hard_brakes > 0 || x.hard_accels > 0) && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', flexWrap: 'wrap' }}>
                  {x.hard_brakes > 0 && <span>{t('trips.brakes')}: {x.hard_brakes}</span>}
                  {x.hard_accels > 0 && <span>{t('trips.accels')}: {x.hard_accels}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>,
    document.body
  )
}

export default function DrivingTripsCard({ Toggle }) {
  const t = useT()
  const userId = useAuthStore(s => s.user?.id)
  const [on, setOn] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase.from('user_alert_prefs').select('driving_trips').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setOn(data?.driving_trips === true) })
      .catch(() => { if (alive) setOn(false) })
    return () => { alive = false }
  }, [userId])

  if (on === null) return null

  const toggle = async () => {
    const next = !on
    setOn(next)
    const { error } = await supabase.from('user_alert_prefs')
      .upsert({ user_id: userId, driving_trips: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) { setOn(!next); return }
    // Turning it off takes the person's own history with it.
    if (!next) await supabase.from('trips').delete().eq('user_id', userId)
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('trips.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('trips.subtitle')}
          </div>
        </div>
        <Toggle on={on} onToggle={toggle} />
      </div>
      <button onClick={() => setOpen(true)} style={{
        marginTop: 12, width: '100%', padding: '10px 12px', borderRadius: 12,
        background: 'var(--maroon-wash)', border: '1.5px solid #F0D8E3', color: 'var(--maroon)',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
      }}>
        {t('trips.view')}
      </button>
      {open && <TripsSheet onClose={() => setOpen(false)} />}
    </div>
  )
}
