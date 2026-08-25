import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const toEmail = (mobile) => `91${mobile.replace(/[^0-9]/g, '')}@familyguard.app`

// Clean open/closed eye icon — no emoji. `open` = password visible.
function EyeIcon({ open }) {
  return open ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const { createOwnFamily } = useAuthStore()

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Please enter your name'); return }
    if (mobile.replace(/[^0-9]/g, '').length !== 10) {
      setError('Enter a valid 10-digit mobile number'); return
    }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (!agreed) { setError('Please accept the Privacy Policy & Terms to continue'); return }

    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: toEmail(mobile), password,
        options: { data: { display_name: name } },
      })
      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          throw new Error('This mobile number is already registered. Please sign in.')
        }
        throw signUpError
      }
      if (!data.user) throw new Error('Registration failed')
      await createOwnFamily(data.user.id, name)
      window.location.href = '/onboarding'
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ borderRadius: 28, padding: "28px 28px", maxHeight: "92vh", overflowY: "auto" }}>
        <div className="auth-logo" style={{ background: 'none', boxShadow: 'none', width: 'auto', height: 'auto', marginBottom: 14 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: 'linear-gradient(145deg, #951345 0%, #720D35 55%, #4A0820 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto',
            boxShadow:
              'inset 0 2px 0 rgba(255,255,255,0.22), inset 0 0 0 1.5px rgba(232,201,106,0.45), 0 16px 44px rgba(66,12,36,0.60), 0 0 50px rgba(149,19,69,0.35)',
          }}>
            <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
              <path d="M24 4L8 11V24C8 33.6 15.2 42.4 24 44C32.8 42.4 40 33.6 40 24V11L24 4Z" fill="url(#shieldGradR)"/>
              <path d="M24 7L10 13.2V24C10 32.5 16.4 40.4 24 42C31.6 40.4 38 32.5 38 24V13.2L24 7Z"
                fill="none" stroke="rgba(232,201,106,0.50)" strokeWidth="1.2"/>
              <path d="M17 24.5L21.5 29L31 19" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="shieldGradR" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#C0185A"/><stop offset="100%" stopColor="#4A0820"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        <h1 className="auth-title" style={{ fontSize: 26, marginBottom: 4 }}>Create Account</h1>
        <p className="auth-subtitle" style={{ marginBottom: 20 }}>Join FamilyGuard to keep your family safe</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleRegister} noValidate>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Your name</label>
            <input className="input" type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Prabhakaran" required />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Mobile number</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                background: '#F5F4FB', border: '1.5px solid #E9E6FB',
                borderRadius: 12, padding: '10px 12px',
                fontWeight: 700, fontSize: 14, color: '#3A1020',
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🇮🇳 +91
              </div>
              <input className="input" type="tel" value={mobile}
                onChange={e => setMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="98765 43210" required style={{ flex: 1 }} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input className="input" type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 6 characters" required style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 18, padding: 4, lineHeight: 1,
                }}>
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Confirm password</label>
            <div style={{ position: 'relative' }}>
              <input className="input" type={showConfirm ? 'text' : 'password'} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter password" required style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowConfirm(s => !s)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 18, padding: 4, lineHeight: 1,
                }}>
                <EyeIcon open={showConfirm} />
              </button>
            </div>
          </div>

          {/* Terms & Privacy Policy checkbox */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            margin: '4px 0 8px', padding: '12px 14px',
            background: agreed ? '#F0FDF4' : '#F8F7FF',
            borderRadius: 12,
            border: `1.5px solid ${agreed ? '#10B981' : '#E9E6FB'}`,
            transition: 'all 0.2s', cursor: 'pointer',
          }} onClick={() => setAgreed(a => !a)}>
            {/* Custom checkbox */}
            <div style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
              background: agreed ? '#10B981' : '#fff',
              border: `2px solid ${agreed ? '#10B981' : '#C4BEE8'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}>
              {agreed && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, userSelect: 'none' }}>
              I have read and agree to the{' '}
              <Link
                to="/privacy"
                onClick={e => e.stopPropagation()}
                style={{ color: '#951345', fontWeight: 700, textDecoration: 'underline' }}
              >
                Privacy Policy & Terms
              </Link>
              {' '}of FamilyGuard
            </div>
          </div>

          <button className="btn btn-primary" type="submit"
            disabled={loading || !agreed} style={{ marginTop: 4, opacity: agreed ? 1 : 0.6 }}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
