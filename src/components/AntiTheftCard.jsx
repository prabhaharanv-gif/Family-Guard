import { useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { LocationService } from '../lib/locationPlugin'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'
import Dialog from './Dialog'

const CallAlarm = registerPlugin('CallAlarm')

/**
 * Profile → Anti-theft.
 *
 * Two switches, both off unless the owner turns them on:
 *
 *  1. Wrong-password alert — after 3 wrong screen-lock attempts the phone tells
 *     the family ADMINS, with where it was last seen. Needs Android's
 *     "device admin" permission, asked for in the system's own dialog; Famora
 *     asks for the watch-login policy only (no lock, no wipe).
 *  2. Photo (experimental) — also takes one front-camera photo, readable only
 *     by the owner and those admins. Needs camera and display-over-apps, and
 *     does not work on every phone.
 *
 * The setting the server checks (user_alert_prefs.unlock_alert) is written here;
 * the phone-side switches live in native storage because the receiver that
 * counts attempts runs with the app closed.
 */
export default function AntiTheftCard({ Toggle }) {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const [st, setSt] = useState(null)               // native state, null until read
  const [explain, setExplain] = useState(null)     // 'alert' | 'photo' | null
  const [alerts, setAlerts] = useState([])
  const [urls, setUrls] = useState({})
  const pending = useRef(null)                     // 'alert' | 'photo' while a system screen is open

  const refresh = useCallback(async () => {
    try { setSt(await LocationService.getAntiTheft()) } catch { setSt(false) }
  }, [])

  const setServerFlag = useCallback(async (on) => {
    if (!user?.id) return
    await supabase.from('user_alert_prefs')
      .upsert({ user_id: user.id, unlock_alert: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }, [user?.id])

  // Finish whatever the person was granting once they come back from Android's screen.
  const settle = useCallback(async () => {
    const s = await LocationService.getAntiTheft().catch(() => null)
    if (!s) return
    if (pending.current === 'alert' && s.adminActive) {
      pending.current = null
      await LocationService.setAntiTheft({ enabled: true, photo: s.photo })
      await setServerFlag(true)
    } else if (pending.current === 'photo' && s.cameraGranted && s.overlayGranted && s.adminActive) {
      pending.current = null
      await LocationService.setAntiTheft({ enabled: true, photo: true })
    }
    setSt(await LocationService.getAntiTheft().catch(() => false))
  }, [setServerFlag])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    refresh()
    let sub
    CapApp.addListener('resume', settle).then(h => { sub = h })
    return () => { sub?.remove() }
  }, [refresh, settle])

  // The alerts this person may see: their own, and those of members of families they administer.
  useEffect(() => {
    if (!familyId || Capacitor.getPlatform() !== 'android') return
    let alive = true
    ;(async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString()
      const [a, m] = await Promise.all([
        supabase.from('unlock_alerts').select('id, user_id, attempts, lat, lng, photo_path, created_at')
          .eq('family_id', familyId).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
        supabase.from('family_members').select('user_id, display_name').eq('family_id', familyId),
      ])
      if (!alive) return
      const names = {}
      for (const x of m.data || []) names[x.user_id] = x.display_name
      const rows = (a.data || []).map(r => ({ ...r, name: names[r.user_id] || '—' }))
      setAlerts(rows)
      const map = {}
      await Promise.all(rows.filter(r => r.photo_path).map(async r => {
        const { data } = await supabase.storage.from('unlock-photos').createSignedUrl(r.photo_path, 600)
        if (data?.signedUrl) map[r.id] = data.signedUrl
      }))
      if (alive) setUrls(map)
    })().catch(() => {})
    return () => { alive = false }
  }, [familyId])

  if (Capacitor.getPlatform() !== 'android' || st === null || st === false) return null

  const alertOn = st.enabled && st.adminActive

  const startAlert = async () => {
    setExplain(null)
    pending.current = 'alert'
    try { await LocationService.requestAntiTheftAdmin() } catch { pending.current = null }
  }

  const turnOffAlert = async () => {
    pending.current = null
    await LocationService.removeAntiTheftAdmin().catch(() => {})
    await setServerFlag(false)
    await refresh()
  }

  const startPhoto = async () => {
    setExplain(null)
    pending.current = 'photo'
    // Ask for the camera the way the app already does for calls: the WebView
    // shows Android's permission prompt.
    if (!st.cameraGranted) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        s.getTracks().forEach(tr => tr.stop())
      } catch { /* refused: settle() will simply not finish */ }
    }
    const now = await LocationService.getAntiTheft().catch(() => st)
    if (!now.overlayGranted) {
      try { await CallAlarm.openOverlaySettings() } catch {}
      return   // settle() finishes when they come back
    }
    await settle()
  }

  const turnOffPhoto = async () => {
    await LocationService.setAntiTheft({ enabled: true, photo: false })
    await refresh()
  }

  const row = { display: 'flex', alignItems: 'center', gap: 12 }
  const head = { fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }
  const sub  = { fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }

  return (
    <>
      <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
        <div style={row}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={head}>{t('antiTheft.title')}</div>
            <div style={sub}>{t('antiTheft.subtitle')}</div>
          </div>
          <Toggle on={alertOn} onToggle={() => (alertOn ? turnOffAlert() : setExplain('alert'))} />
        </div>
      </div>

      {alertOn && (
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={head}>{t('antiTheft.photoTitle')}</div>
              <div style={sub}>{t('antiTheft.photoSubtitle')}</div>
            </div>
            <Toggle on={st.photo} onToggle={() => (st.photo ? turnOffPhoto() : setExplain('photo'))} />
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ ...head, marginBottom: 8 }}>{t('antiTheft.recent')}</div>
          {alerts.map(a => (
            <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid #F5EEF2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                <span>{a.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
                  {new Date(a.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginTop: 3 }}>
                {t('antiTheft.attempts', { n: a.attempts })}
                {a.lat != null && a.lng != null && (
                  <> · <a href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--maroon)', fontWeight: 800 }}>{t('antiTheft.map')}</a></>
                )}
              </div>
              {urls[a.id] && (
                <img src={urls[a.id]} alt="" style={{ marginTop: 8, width: 120, borderRadius: 10, display: 'block' }} />
              )}
            </div>
          ))}
        </div>
      )}

      {explain === 'alert' && (
        <Dialog type="confirm" title={t('antiTheft.title')} message={t('antiTheft.explainAlert')}
          confirmLabel={t('antiTheft.continue')} onConfirm={startAlert} onClose={() => setExplain(null)} />
      )}
      {explain === 'photo' && (
        <Dialog type="confirm" title={t('antiTheft.photoTitle')} message={t('antiTheft.explainPhoto')}
          confirmLabel={t('antiTheft.continue')} onConfirm={startPhoto} onClose={() => setExplain(null)} />
      )}
    </>
  )
}
