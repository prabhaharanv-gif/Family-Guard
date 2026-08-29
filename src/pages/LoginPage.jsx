import { useState, useEffect } from 'react'
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
  const [otp, setOtp]                   = useState('')
  const [newPassword, setNewPassword]   = useState('')
  const [confirmPw, setConfirmPw]       = useState('')
  const [step, setStep]                 = useState(1)   // 1 mobile, 2 otp, 3 new password
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState(false)
  const [resendIn, setResendIn]         = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setInterval(() => setResendIn(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [resendIn])

  // Step 1 — confirm an account exists for this number, then send an OTP to prove ownership
  const handleContinue = async () => {
    setError('')
    const digits = mobile.replace(/[^0-9]/g, '')
    if (!digits || digits.length !== 10) { setError('Enter a valid 10-digit mobile number'); return }
    setLoading(true)
    // Check if user exists by attempting sign-in with wrong password
    const { error: e } = await supabase.auth.signInWithPassword({
      email: `91${digits}@familyguard.app`, password: '___x___',
    })
    if (!e?.message?.includes('Invalid login credentials')) {
      setLoading(false)
      setError('No account found for this mobile number')
      return
    }
    const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: `+91${digits}` })
    setLoading(false)
    if (otpErr) { setError(otpErr.message || 'Could not send verification code'); return }
    setStep(2)
    setResendIn(30)
  }

  const handleResendOtp = async () => {
    if (resendIn > 0) return
    setError('')
    setLoading(true)
    const digits = mobile.replace(/[^0-9]/g, '')
    const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: `+91${digits}` })
    setLoading(false)
    if (otpErr) { setError(otpErr.message || 'Could not resend code'); return }
    setResendIn(30)
  }

  // Step 2 — verify the OTP. This is what actually proves phone ownership; the resulting
  // session's verified phone claim is what step 3's RPC trusts (never a client-supplied number).
  const handleVerifyOtp = async () => {
    setError('')
    if (otp.replace(/[^0-9]/g, '').length !== 6) { setError('Enter the 6-digit code'); return }
    setLoading(true)
    const digits = mobile.replace(/[^0-9]/g, '')
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: `+91${digits}`, token: otp, type: 'sms',
    })
    setLoading(false)
    if (verifyErr) { setError('Incorrect or expired code. Please try again.'); return }
    setStep(3)
  }

  // Step 3 — set the new password. reset_password_verified() reads the phone number from
  // this session's server-verified JWT claim, not from any client-supplied parameter.
  const handleReset = async () => {
    setError('')
    if (!newPassword || newPassword.length < 6) { setError('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPw) { setError('Passwords do not match'); return }
    setLoading(true)
    const { error: rpcErr } = await supabase.rpc('reset_password_verified', {
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
              {step === 1 ? 'Enter your registered mobile number'
                : step === 2 ? `Enter the code sent to +91 ${mobile}`
                : 'Set your new password'}
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
            ) : step === 2 ? (
              <>
                <input className="input" type="text" inputMode="numeric" value={otp} autoFocus
                  onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  style={{ marginBottom: 16, textAlign: 'center', fontSize: 22, fontWeight: 800, letterSpacing: 6 }} />
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <button onClick={() => setStep(1)} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: '#F8F7FF',
                    border: '1px solid #EDE9FF', color: '#6B7280', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>← Back</button>
                  <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,#951345,#720D35)',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? 'Verifying...' : 'Verify →'}</button>
                </div>
                <button onClick={handleResendOtp} disabled={resendIn > 0 || loading} style={{
                  display: 'block', margin: '0 auto', background: 'none', border: 'none',
                  fontWeight: 700, fontSize: 13, padding: 0,
                  color: resendIn > 0 ? '#B0AAC8' : '#951345',
                  cursor: resendIn > 0 ? 'default' : 'pointer',
                }}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button>
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
                  <button onClick={() => setStep(2)} style={{
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
    const digits = mobile.replace(/[^0-9]/g, '')
    if (!digits || digits.length !== 10) { setError('Enter a valid 10-digit mobile number'); return }
    if (!password) { setError('Please enter your password'); return }
    const email = `91${digits}@familyguard.app`
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) { setError('Invalid mobile number or password'); return }
    navigate('/')
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ borderRadius: 28, padding: "40px 32px" }}>
        {/* Brand shield — maroon + gold, no emoji to avoid OS colour override */}
        <div className="auth-logo" style={{ background: 'none', boxShadow: 'none', width: 'auto', height: 'auto', marginBottom: 20 }}>
          <div style={{
            width: 96, height: 96, borderRadius: 28,
            background: 'linear-gradient(145deg, #951345 0%, #720D35 55%, #4A0820 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto',
            boxShadow:
              'inset 0 2px 0 rgba(255,255,255,0.22), inset 0 0 0 1.5px rgba(232,201,106,0.45), 0 16px 44px rgba(66,12,36,0.60), 0 0 50px rgba(149,19,69,0.35)',
          }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              {/* Shield body */}
              <path d="M24 4L8 11V24C8 33.6 15.2 42.4 24 44C32.8 42.4 40 33.6 40 24V11L24 4Z"
                fill="url(#shieldGrad)" />
              {/* Gold inner rim */}
              <path d="M24 7L10 13.2V24C10 32.5 16.4 40.4 24 42C31.6 40.4 38 32.5 38 24V13.2L24 7Z"
                fill="none" stroke="rgba(232,201,106,0.50)" strokeWidth="1.2"/>
              {/* Checkmark */}
              <path d="M17 24.5L21.5 29L31 19"
                stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="shieldGrad" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#C0185A"/>
                  <stop offset="100%" stopColor="#4A0820"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        <h1 className="auth-title" style={{ marginBottom: 24 }}>famora</h1>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Mobile number</label>
            <input className="input" type="tel" value={mobile}
              onChange={e => setMobile(e.target.value)}
              placeholder="9876543210" autoComplete="tel" />
          </div>
          <div className="input-group">
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6, letterSpacing: 0.2 }}>Password</label>
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
