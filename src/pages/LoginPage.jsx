import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

function ForgotPasswordModal({ onClose }) {
  const [mobile, setMobile]             = useState('')
  const [newPassword, setNewPassword]   = useState('')
  const [confirmPw, setConfirmPw]       = useState('')
  const [step, setStep]                 = useState(1)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState(false)

  const handleContinue = async () => {
    setError('')
    const digits = mobile.replace(/\D/g, '')
    if (!digits || digits.length < 10) { setError('Enter a valid 10-digit mobile number'); return }
    setLoading(true)
    // Check if user exists by attempting sign-in with wrong password
    const { error: e } = await supabase.auth.signInWithPassword({
      email: `${digits}@familyguard.app`, password: '___x___',
    })
    setLoading(false)
    if (e?.message?.includes('Invalid login credentials')) {
      setStep(2)
    } else {
      setError('No account found for this mobile number')
    }
  }

  const handleReset = async () => {
    setError('')
    if (!newPassword || newPassword.length < 6) { setError('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPw) { setError('Passwords do not match'); return }
    setLoading(true)
    const { error: rpcErr } = await supabase.rpc('reset_user_password', {
      p_mobile: mobile.replace(/\D/g, ''),
      p_new_password: newPassword,
    })
    setLoading(false)
    if (rpcErr) { setError('Could not reset: ' + rpcErr.message); return }
    setSuccess(true)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '24px 20px 28px' }}>
        <div className="popup-handle" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: '#FDF0F5', border: '1.5px solid #F9C6D8',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>🔑</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0C1D' }}>Reset Password</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
              {step === 1 ? 'Enter your registered mobile number' : 'Set your new password'}
            </div>
          </div>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#16A34A', marginBottom: 8 }}>Password Reset!</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
              You can now sign in with your new password.
            </div>
            <button onClick={onClose} className="btn btn-primary">Back to Sign In</button>
          </div>
        ) : (
          <>
            {error && <div className="error-msg">{error}</div>}
            {step === 1 ? (
              <>
                <input className="input" value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  placeholder="Mobile number (e.g. 9876543210)"
                  autoFocus style={{ marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={onClose} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: '#F8F7FF',
                    border: '1px solid #EDE9FF', color: '#6B7280', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>Cancel</button>
                  <button onClick={handleContinue} disabled={loading} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,#951345,#720D35)',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? 'Checking...' : 'Continue →'}</button>
                </div>
              </>
            ) : (
              <>
                <input className="input" type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password (min. 6 characters)"
                  autoFocus style={{ marginBottom: 10 }} />
                <input className="input" type="password" value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Confirm new password"
                  style={{ marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setStep(1)} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: '#F8F7FF',
                    border: '1px solid #EDE9FF', color: '#6B7280', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>← Back</button>
                  <button onClick={handleReset} disabled={loading} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,#951345,#720D35)',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? 'Resetting...' : 'Reset Password'}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [mobile, setMobile]             = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [showForgot, setShowForgot]     = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    const digits = mobile.replace(/\D/g, '')
    if (!digits) { setError('Enter your mobile number'); return }
    if (!password) { setError('Enter your password'); return }
    const email = `${digits}@familyguard.app`
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) { setError('Invalid mobile number or password'); return }
    navigate('/')
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🛡️</div>
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-sub">Sign in to FamilyGuard</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <label className="input-label">Mobile Number</label>
            <input className="input" type="tel" value={mobile}
              onChange={e => setMobile(e.target.value)}
              placeholder="9876543210" autoComplete="tel" />
          </div>
          <div className="input-group">
            <label className="input-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input className="input" type={showPassword ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Your password" style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, padding: 4, lineHeight: 1,
              }}>
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <button type="button" onClick={() => setShowForgot(true)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#951345', fontWeight: 700, fontSize: 13,
            fontFamily: 'inherit', marginTop: 12, width: '100%',
            display: 'block', textAlign: 'center',
          }}>
            Forgot Password?
          </button>
        </form>

        <p className="auth-link">
          Don't have an account? <Link to="/register">Register</Link>
        </p>

        {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
      </div>
    </div>
  )
}
