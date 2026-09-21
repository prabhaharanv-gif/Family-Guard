/**
 * ConsentGate
 *
 * Wraps the entire authenticated app. Shows a privacy policy consent
 * screen before allowing access. Only gates logged-in users who haven't
 * agreed yet — unauthenticated users pass through (PrivateRoute handles redirect).
 *
 * Consent is stored both in localStorage (fast local check) AND server-side
 * in user_consents table (survives reinstalls, new devices, cleared app data).
 */

import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import PolicyContent from './PolicyContent'
import { setCrashReportingEnabled, setCrashUserId } from '../lib/crashReporting'
import Icon from './Icon'
import { useT } from '../i18n'

export default function ConsentGate({ children }) {
  const { user, loading } = useAuthStore()
  const t = useT()
  const [agreed, setAgreed] = useState(() => {
    try { return localStorage.getItem('privacy_agreed') === '1' } catch { return false }
  })
  const [checking, setChecking] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)

  // On login, verify consent server-side — covers reinstalls / new devices / cleared data
  useEffect(() => {
    if (!user || agreed) return
    setChecking(true)
    supabase
      .from('user_consents')
      .select('id')
      .eq('user_id', user.id)
      .eq('consent_type', 'privacy_policy')
      .limit(1)
      // maybeSingle, not single: single() treats "no row yet" as an error,
      // which is the normal first-run case and made failures indistinguishable
      // from a genuine lookup problem.
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn('[ConsentGate] consent lookup failed:', error.message)
        } else if (data) {
          try { localStorage.setItem('privacy_agreed', '1') } catch {}
          setAgreed(true)
        }
        setChecking(false)
      })
  }, [user])

  // Crash reporting ships disabled in the manifest and only turns on once the
  // user has accepted the policy that discloses it. Covers both routes to
  // consent — the server-side lookup above and handleAgree below.
  useEffect(() => {
    if (!user || !agreed) return
    setCrashReportingEnabled(true)
    setCrashUserId(user.id)
  }, [user, agreed])

  if (loading || checking) {
    return (
      <div className="splash">
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--maroon)', fontFamily: 'Sora, sans-serif' }}>famora</div>
      </div>
    )
  }
  if (!user) return children  // unauthenticated — let PrivateRoute handle redirect

  const handleAgree = async () => {
    try { localStorage.setItem('privacy_agreed', '1') } catch {}
    // Record server-side — survives reinstalls and new devices. The result
    // was previously discarded, so when this table was missing the failure
    // went unnoticed and consent was re-asked on every login.
    const { error } = await supabase.from('user_consents').upsert({
      user_id:      user.id,
      consent_type: 'privacy_policy',
      agreed_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,consent_type' })
    if (error) console.error('[ConsentGate] could not save consent:', error.message)
    setAgreed(true)
  }

  if (!agreed) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        {showPolicy ? (
          <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--maroon) 0%, var(--maroon-deep) 100%)',
              padding: '16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            }}>
              <button onClick={() => setShowPolicy(false)} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, width: 36, height: 36, cursor: 'pointer',
                fontSize: 18, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>←</button>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'Sora, sans-serif' }}>{t('settings.privacyPolicy')}</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 0' }}>
              <PolicyContent />
              <div style={{ padding: '20px 0 40px' }}>
                <button onClick={handleAgree} style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
                  border: 'none', color: '#fff', fontWeight: 800,
                  fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
                }}><Icon name="checkCircle" /> {t('consent.agreeFamora')}</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ marginBottom: 12, color: 'var(--maroon)' }}><Icon name="shield" size={56} strokeWidth={1.6} /></div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginBottom: 8, fontFamily: 'Sora, sans-serif' }}>
                {t('consent.title')}
              </div>
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6 }}>
                {t('consent.body')}
              </div>
            </div>

            {[
              { icon: 'pin', text: t('consent.location') },
              { icon: 'message', text: t('consent.messages') },
              { icon: 'lock', text: t('consent.noSell') },
              { icon: 'trash', text: t('consent.deleteAnytime') },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: '#fff', borderRadius: 14, padding: '14px 16px',
                marginBottom: 10, border: '1px solid var(--border)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}>
                <span style={{ flexShrink: 0, color: 'var(--maroon)', display: 'flex' }}><Icon name={item.icon} size={22} /></span>
                <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.4 }}>{item.text}</span>
              </div>
            ))}

            <button onClick={() => setShowPolicy(true)} style={{
              width: '100%', padding: '13px 16px', borderRadius: 14, marginTop: 6,
              background: 'var(--bg2)', border: '1.5px solid var(--border)',
              color: 'var(--maroon)', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer', marginBottom: 12,
            }}>
              <Icon name="file" /> {t('consent.readFull')}
            </button>

            <button onClick={handleAgree} style={{
              width: '100%', padding: 16, borderRadius: 16,
              background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
              border: 'none', color: '#fff', fontWeight: 800,
              fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
            }}>
              <Icon name="checkCircle" /> {t('consent.agree')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return children
}
