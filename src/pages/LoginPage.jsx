import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { withCaptcha } from '../lib/captcha'
import { PASSWORD_MIN_LENGTH } from '../lib/passwordPolicy'
import { useT } from '../i18n'
import AuthLanguagePicker from '../components/AuthLanguagePicker'
import Dialog from '../components/Dialog'
import famoraLogo from '../assets/famora-logo.jpg'
import Icon from '../components/Icon'

function EyeIcon({ open }) {
  return open ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

function ForgotPasswordModal({ onClose }) {
  const t = useT()
  const [mobile, setMobile]             = useState('')
  const [otp, setOtp]                   = useState('')
  const [newPassword, setNewPassword]   = useState('')
  const [confirmPw, setConfirmPw]       = useState('')
  const [step, setStep]                 = useState(1)   // 1 mobile, 2 otp, 3 new password
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState(false)
  const [popup, setPopup]               = useState(false)
  const [resendIn, setResendIn]         = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setInterval(() => setResendIn(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  // Step 1 — confirm an account exists for this number, then send an OTP to prove ownership
  const handleContinue = async () => {
    setError('')
    const digits = mobile.replace(/[^0-9]/g, '')
    if (!digits || digits.length !== 10) { setError(t('auth.enterValidMobile')); return }
    setLoading(true)
    // No existence probe before sending the OTP.
    //
    // This used to sign in with a deliberately wrong password and read
    // "Invalid login credentials" as proof the account existed. Supabase
    // returns that message whether or not it does — anti-enumeration, by
    // design — so the check passed for every number and told us nothing. Worse
    // for the email variant, which reported "no account for this mobile" at
    // accounts that plainly had one, because an OTP-era account has no email.
    //
    // Sending the OTP unconditionally is what the reset flow needs anyway: the
    // account is resolved by reset_password_verified once ownership is proven,
    // and it raises 'No account found for this verified phone number' there if
    // there really is none.
    const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: `+91${digits}`, options: await withCaptcha() })
    setLoading(false)
    if (otpErr) { setError(otpErr.message || t('reset.couldNotSend')); return }
    setStep(2)
    setResendIn(30)
  }

  const handleResendOtp = async () => {
    if (resendIn > 0) return
    setError('')
    setLoading(true)
    const digits = mobile.replace(/[^0-9]/g, '')
    const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: `+91${digits}`, options: await withCaptcha() })
    setLoading(false)
    if (otpErr) { setError(otpErr.message || t('reset.couldNotResend')); return }
    setResendIn(30)
  }

  // Step 2 — verify the OTP. This is what actually proves phone ownership; the resulting
  // session's verified phone claim is what step 3's RPC trusts (never a client-supplied number).
  const handleVerifyOtp = async () => {
    setError('')
    if (otp.replace(/[^0-9]/g, '').length !== 6) { setError(t('reset.enterSixDigit')); return }
    setLoading(true)
    const digits = mobile.replace(/[^0-9]/g, '')
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: `+91${digits}`, token: otp, type: 'sms',
    })
    setLoading(false)
    if (verifyErr) { setError(t('reset.incorrectCode')); return }
    setStep(3)
  }

  // Step 3 — set the new password. reset_password_verified() reads the phone number from
  // this session's server-verified JWT claim, not from any client-supplied parameter.
  const handleReset = async () => {
    setError('')
    if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) { setPopup(true); return }
    if (newPassword !== confirmPw) { setError(t('reset.passwordsNoMatch')); return }
    setLoading(true)
    const { error: rpcErr } = await supabase.rpc('reset_password_verified', {
      p_new_password: newPassword,
    })
    setLoading(false)
    if (rpcErr) { setError(t('reset.couldNotReset', { reason: rpcErr.message })); return }
    setSuccess(true)
  }

  return (
    <>
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '24px 20px 28px' }}>
        <div className="popup-handle" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: 'var(--maroon-wash)', border: '1.5px solid #F9C6D8',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--maroon)',
          }}><Icon name="key" size={22} /></div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{t('reset.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {step === 1 ? t('reset.step1Sub')
                : step === 2 ? t('reset.step2Sub', { mobile })
                : t('reset.step3Sub')}
            </div>
          </div>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ marginBottom: 12 }}><Icon name="checkCircle" size={48} color="#16A34A" strokeWidth={1.8} /></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#16A34A', marginBottom: 8 }}>{t('reset.successTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              {t('reset.successBody')}
            </div>
            <button onClick={onClose} className="btn btn-primary">{t('reset.backToSignIn')}</button>
          </div>
        ) : (
          <>
            {error && <Dialog type="info" message={error} onClose={() => setError('')} />}
            {step === 1 ? (
              <>
                <input className="input" value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  placeholder={t('auth.mobileNumber')}
                  autoFocus style={{ marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={onClose} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: 'var(--bg2)',
                    border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{t('common.cancel')}</button>
                  <button onClick={handleContinue} disabled={loading} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? t('reset.checking') : t('common.continue') + ' →'}</button>
                </div>
              </>
            ) : step === 2 ? (
              <>
                <input className="input" type="text" inputMode="numeric" value={otp} autoFocus
                  onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder={t('reset.sixDigitCode')}
                  style={{ marginBottom: 16, textAlign: 'center', fontSize: 22, fontWeight: 800, letterSpacing: 6 }} />
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <button onClick={() => setStep(1)} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: 'var(--bg2)',
                    border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>← {t('common.back')}</button>
                  <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? t('reset.verifying') : t('reset.verify') + ' →'}</button>
                </div>
                <button onClick={handleResendOtp} disabled={resendIn > 0 || loading} style={{
                  display: 'block', margin: '0 auto', background: 'none', border: 'none',
                  fontWeight: 700, fontSize: 13, padding: 0,
                  color: resendIn > 0 ? 'var(--muted3)' : 'var(--maroon)',
                  cursor: resendIn > 0 ? 'default' : 'pointer',
                }}>{resendIn > 0 ? t('reset.resendIn', { n: resendIn }) : t('reset.resendCode')}</button>
              </>
            ) : (
              <>
                <input className="input" type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={t('reset.newPasswordPh')}
                  autoFocus style={{ marginBottom: 10 }} />
                <input className="input" type="password" value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder={t('reset.confirmNewPassword')}
                  style={{ marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setStep(2)} style={{
                    flex: 1, padding: 14, borderRadius: 14, background: 'var(--bg2)',
                    border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>← {t('common.back')}</button>
                  <button onClick={handleReset} disabled={loading} style={{
                    flex: 2, padding: 14, borderRadius: 14,
                    background: 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))',
                    border: 'none', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>{loading ? t('reset.resetting') : t('reset.title')}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>

    {/* Outside the overlay: a tap on the dialog backdrop must not bubble up
        and close the whole reset sheet. */}
    {popup && (
      <Dialog type="info" title={t('register.passwordShortTitle')}
        message={t('register.passwordShortBody')} onClose={() => setPopup(false)} />
    )}
    </>
  )
}

export default function LoginPage() {
  const t = useT()
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
    if (!digits || digits.length !== 10) { setError(t('auth.enterValidMobile')); return }
    if (!password) { setError(t('auth.enterPassword')); return }
    // Two eras of account, and they are identified differently.
    //
    //   Registered before the OTP flow: auth.users.email holds the synthetic
    //     91XXXXXXXXXX@familyguard.app address, and phone is null.
    //   Registered through the OTP flow: the account is created by verifyOtp,
    //     so auth.users.phone holds the number and EMAIL IS NULL — RegisterPage
    //     asks updateUser() to attach the address afterwards, but an email
    //     change needs confirming and @familyguard.app has no inbox, so it
    //     never lands.
    //
    // Signing in by email only, this second group could not log in at all: the
    // password is set and correct, but nothing matches the address being looked
    // up. It went unnoticed because a session that never expires never asks.
    const { error: phoneErr } = await supabase.auth.signInWithPassword({
      phone: `91${digits}`, password, options: await withCaptcha(),
    })
    if (!phoneErr) { navigate('/'); return }

    const email = `91${digits}@familyguard.app`
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password, options: await withCaptcha() })
    if (authErr) { setError(t('auth.invalidCreds')); return }
    navigate('/')
  }

  return (
    <div className="auth-page">
      <AuthLanguagePicker />
      <div className="auth-card" style={{ borderRadius: 28, padding: "40px 32px" }}>
        {/* Brand icon — same artwork as the launcher icon */}
        <div className="auth-logo auth-logo-brand" style={{ marginBottom: 28 }}>
          <img src={famoraLogo} alt="famora" width={110} height={110}
            style={{ display: 'block', margin: '0 auto', borderRadius: 24 }} />
        </div>

        {error && <Dialog type="info" message={error} onClose={() => setError('')} />}

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <input className="input" type="tel" value={mobile}
              onChange={e => setMobile(e.target.value)}
              placeholder={t('auth.mobileNumber')} aria-label={t('auth.mobileNumber')} autoComplete="tel" />
          </div>
          <div className="input-group">
            <div style={{ position: 'relative' }}>
              <input className="input" type={showPassword ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder={t('auth.password')} aria-label={t('auth.password')} style={{ paddingRight: 44 }} />
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
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </button>

          <button type="button" onClick={() => setShowForgot(true)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--maroon)', fontWeight: 700, fontSize: 13,
            fontFamily: 'inherit', marginTop: 12, width: '100%',
            display: 'block', textAlign: 'center',
          }}>
            {t('auth.forgotPassword')}
          </button>
        </form>

        <p className="auth-link">
          {t('auth.noAccount')} <Link to="/register">{t('auth.register')}</Link>
        </p>

        {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
      </div>
    </div>
  )
}
