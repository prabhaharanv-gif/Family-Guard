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

export default function ConsentGate({ children }) {
  const { user, loading } = useAuthStore()
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
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'Sora, sans-serif' }}>famora</div>
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#F8F7FF', display: 'flex', flexDirection: 'column' }}>
        {showPolicy ? (
          <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: '#F8F7FF', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              background: 'linear-gradient(135deg, #951345 0%, #720D35 100%)',
              padding: '16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            }}>
              <button onClick={() => setShowPolicy(false)} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, width: 36, height: 36, cursor: 'pointer',
                fontSize: 18, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>←</button>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'Sora, sans-serif' }}>Privacy Policy</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 0' }}>
              <PolicyContent />
              <div style={{ padding: '20px 0 40px' }}>
                <button onClick={handleAgree} style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg, #951345, #720D35)',
                  border: 'none', color: '#fff', fontWeight: 800,
                  fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(149,19,69,0.35)',
                }}>✅ I Agree — Continue to Famora</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>🛡️</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0D0C1D', marginBottom: 8, fontFamily: 'Sora, sans-serif' }}>
                Before You Continue
              </div>
              <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
                We've updated our Privacy Policy. Please review and accept it to continue using Famora.
              </div>
            </div>

            {[
              { icon: '📍', text: 'Your location is shared only with your own family group' },
              { icon: '💬', text: 'Messages are visible only to your family members' },
              { icon: '🔒', text: 'We never sell or share your data with anyone' },
              { icon: '🗑️', text: 'You can delete your account and all data anytime' },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: '#fff', borderRadius: 14, padding: '14px 16px',
                marginBottom: 10, border: '1px solid #F0EAF5',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>{item.text}</span>
              </div>
            ))}

            <button onClick={() => setShowPolicy(true)} style={{
              width: '100%', padding: '13px 16px', borderRadius: 14, marginTop: 6,
              background: '#F8F7FF', border: '1.5px solid #E9E6FB',
              color: '#951345', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer', marginBottom: 12,
            }}>
              📄 Read Full Privacy Policy
            </button>

            <button onClick={handleAgree} style={{
              width: '100%', padding: 16, borderRadius: 16,
              background: 'linear-gradient(135deg, #951345, #720D35)',
              border: 'none', color: '#fff', fontWeight: 800,
              fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(149,19,69,0.35)',
            }}>
              ✅ I Agree — Continue
            </button>
          </div>
        )}
      </div>
    )
  }

  return children
}
