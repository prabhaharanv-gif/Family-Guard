import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

/**
 * Profile → Safety → Allow "Phone lost".
 *
 * Off unless the phone's owner turns it on: with it on, a family admin can mark
 * THIS phone lost from its member card, which makes it report its position
 * every few seconds, ring every 2 minutes and show a message on the lock screen.
 * The setting lives on the server (user_alert_prefs.allow_lost_mode) because the
 * server is what checks it before anyone can start lost mode.
 */
export default function LostPhoneCard({ Toggle }) {
  const t = useT()
  const userId = useAuthStore(s => s.user?.id)
  const [on, setOn] = useState(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase.from('user_alert_prefs').select('allow_lost_mode').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setOn(data?.allow_lost_mode === true) })
      .catch(() => { if (alive) setOn(false) })
    return () => { alive = false }
  }, [userId])

  if (on === null) return null

  const toggle = async () => {
    const next = !on
    setOn(next)
    const { error } = await supabase.from('user_alert_prefs')
      .upsert({ user_id: userId, allow_lost_mode: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) setOn(!next)
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('lostPhone.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('lostPhone.subtitle')}
          </div>
        </div>
        <Toggle on={on} onToggle={toggle} />
      </div>
    </div>
  )
}
