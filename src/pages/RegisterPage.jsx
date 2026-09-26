import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { withCaptcha } from '../lib/captcha'
import { PASSWORD_MIN_LENGTH } from '../lib/passwordPolicy'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'
import AuthLanguagePicker from '../components/AuthLanguagePicker'
import Dialog from '../components/Dialog'
import famoraLogo from '../assets/famora-logo.jpg'

// Clean open/closed eye icon — no emoji. `open` = password visible.
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

const toE164 = (mobile) => `+91${mobile.replace(/[^0-9]/g, '')}`

export default function RegisterPage() {
  const t = useT()
  const [step, setStep] = useState(1)   // 1 = details form, 2 = OTP verification
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [popup, setPopup] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [otp, setOtp] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const { createOwnFamily } = useAuthStore()

  // Step 1 → send OTP to the entered mobile number, move to step 2
  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError(t('register.enterName')); return }
    if (mobile.replace(/[^0-9]/g, '').length !== 10) {
      setError(t('auth.enterValidMobile')); return
    }
    // A soft popup rather than the inline error banner: this is the rule people trip over
    // most, and the banner sits above the fields, out of view of the keyboard.
    if (password.length < PASSWORD_MIN_LENGTH) { setPopup(true); return }
    if (password !== confirm) { setError(t('reset.passwordsNoMatch')); return }
    if (!agreed) { setError(t('register.acceptTerms')); return }

    setLoading(true)
    try {
      // No "is this number taken?" probe here, and there cannot be one.
      // signInWithPassword returns "Invalid login credentials" whether or not
      // the account exists — that is deliberate on Supabase's part, to stop
      // anyone enumerating users — so a probe reads as "taken" for every
      // number on earth and blocks all registration. The check belongs after
      // verifyOtp, where the answer is actually knowable; see handleVerifyOtp.
      const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: toE164(mobile), options: await withCaptcha() })
      if (otpErr) throw otpErr
      setStep(2)
      setResendIn(30)
    } catch (err) {
      setError(err.message || t('register.couldNotSend'))
    } finally {
      setLoading(false)
    }
  }

  // Step 2 → verify the OTP, then attach the password to the now-authenticated session
  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (otp.replace(/[^0-9]/g, '').length !== 6) { setError(t('reset.enterSixDigit')); return }

    setLoading(true)
    try {
      const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
        phone: toE164(mobile), token: otp, type: 'sms',
      })
      if (verifyErr) throw new Error(t('reset.incorrectCode'))
      if (!verifyData.user) throw new Error(t('register.verificationFailed'))

      // Already registered?
      //
      // verifyOtp signs in an EXISTING user for a known number rather than
      // failing, so without this, "registering" a number that already has an
      // account would quietly overwrite that account's password below. It
      // cannot be caught earlier — Supabase will not reveal whether a number
      // is taken until ownership is proven, which is exactly what the OTP just
      // did.
      //
      // display_name is the marker: registration always sets it a few lines
      // down, so a user carrying one has been through this before. Signed out
      // again first, or a failed registration would leave them holding a
      // session they never asked for.
      if (verifyData.user.user_metadata?.display_name) {
        await supabase.auth.signOut({ scope: 'local' })  // global would end the owner's other sessions
        throw new Error(t('register.alreadyRegistered'))
      }

      // No email. verifyOtp has just created the account with the phone
      // number on it, and asking to add 91XXXXXXXXXX@familyguard.app here only
      // ever queued an email CHANGE that needs confirming from an inbox that
      // does not exist — so auth.users.email stayed null while the app went on
      // believing every account had an address. Login and password reset both
      // looked accounts up by it, so everyone who registered this way was
      // locked out the moment their session ended. The number on the account
      // is the identity now; see 20260901040000_reset_password_finds_otp_accounts.
      const { data: updateData, error: updateErr } = await supabase.auth.updateUser({
        password,
        data: { display_name: name },
      })
      if (updateErr) throw updateErr
      if (!updateData.user) throw new Error(t('register.registrationFailed'))

      await createOwnFamily(updateData.user.id, name)
      window.location.href = '/onboarding'
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (resendIn > 0) return
    setError('')
    setLoading(true)
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: toE164(mobile), options: await withCaptcha() })
      if (otpErr) throw otpErr
      setResendIn(30)
    } catch (err) {
      setError(err.message || t('reset.couldNotResend'))
    } finally {
      setLoading(false)
    }
  }

  // Resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setInterval(() => setResendIn(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  return (
    <div className="auth-page">
      <AuthLanguagePicker />
      <div className="auth-card" style={{ borderRadius: 28, padding: "28px 28px", maxHeight: "92vh", overflowY: "auto" }}>
        {/* Brand icon — same artwork as the login page and the launcher icon.
            Smaller than on login: this card also carries a title and four fields. */}
        <div className="auth-logo auth-logo-brand" style={{ marginBottom: 14 }}>
          <img src={famoraLogo} alt="famora" width={110} height={110}
            style={{ display: 'block', margin: '0 auto', borderRadius: 22 }} />
        </div>
        <h1 className="auth-title" style={{ fontSize: 26, marginBottom: 4, lineHeight: 1.35 }}>{t('register.title')}</h1>
        <p className="auth-subtitle" style={{ marginBottom: 20 }}>
          {step === 1 ? t('register.sub') : t('register.otpSub', { mobile })}
        </p>

        {error && <Dialog type="info" message={error} onClose={() => setError('')} />}

        {step === 2 ? (
          <form onSubmit={handleVerifyOtp} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6, letterSpacing: 0.2 }}>{t('register.verificationCode')}</label>
              <input className="input" type="text" inputMode="numeric" value={otp} autoFocus
                onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder={t('reset.sixDigitCode')} required
                style={{ textAlign: 'center', fontSize: 22, fontWeight: 800, letterSpacing: 6 }} />
            </div>

            <button className="btn btn-primary" type="submit"
              disabled={loading || otp.length !== 6} style={{ marginTop: 4 }}>
              {loading ? t('reset.verifying') : t('register.verifyAndCreate')}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <button type="button" onClick={() => { setStep(1); setOtp(''); setError('') }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                ← {t('register.changeNumber')}
              </button>
              <button type="button" onClick={handleResendOtp} disabled={resendIn > 0 || loading}
                style={{
                  background: 'none', border: 'none', fontWeight: 700, fontSize: 13, padding: 0,
                  color: resendIn > 0 ? 'var(--muted3)' : 'var(--maroon)',
                  cursor: resendIn > 0 ? 'default' : 'pointer',
                }}>
                {resendIn > 0 ? t('reset.resendIn', { n: resendIn }) : t('reset.resendCode')}
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSendOtp} noValidate>
          <div style={{ marginBottom: 12 }}>
            <input className="input" type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('register.yourName')} aria-label={t('register.yourName')}
              required />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                background: 'var(--bg2)', border: '1.5px solid var(--border)',
                borderRadius: 12, padding: '10px 12px',
                fontWeight: 700, fontSize: 14, color: '#3A1020',
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                +91
              </div>
              <input className="input" type="tel" value={mobile}
                onChange={e => setMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder={t('auth.mobileNumber')} aria-label={t('auth.mobileNumber')}
                required style={{ flex: 1 }} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ position: 'relative' }}>
              <input className="input" type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('register.passwordHint')} aria-label={t('register.passwordHint')}
                required style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
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
            <div style={{ position: 'relative' }}>
              <input className="input" type={showConfirm ? 'text' : 'password'} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder={t('register.confirmPassword')} aria-label={t('register.confirmPassword')}
                required style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowConfirm(s => !s)}
                aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
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
            background: agreed ? '#F0FDF4' : 'var(--bg2)',
            borderRadius: 12,
            border: `1.5px solid ${agreed ? '#10B981' : 'var(--border)'}`,
            transition: 'all 0.2s', cursor: 'pointer',
          }} onClick={() => setAgreed(a => !a)}>
            {/* Custom checkbox */}
            <div style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
              background: agreed ? '#10B981' : '#fff',
              border: `2px solid ${agreed ? '#10B981' : 'var(--border2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}>
              {agreed && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, userSelect: 'none' }}>
              {t('register.agreeLead')}{' '}
              <Link
                to="/privacy"
                onClick={e => e.stopPropagation()}
                style={{ color: 'var(--maroon)', fontWeight: 700, textDecoration: 'underline' }}
              >
                {t('register.agreeLink')}
              </Link>
              {' '}{t('register.agreeTail')}
            </div>
          </div>

          <button className="btn btn-primary" type="submit"
            disabled={loading || !agreed} style={{ marginTop: 4, opacity: agreed ? 1 : 0.6 }}>
            {loading ? t('register.sendingCode') : t('register.sendCode')}
          </button>
        </form>
        )}

        <p className="auth-link">
          {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
        </p>
      </div>

      {popup && (
        <Dialog type="info" title={t('register.passwordShortTitle')}
          message={t('register.passwordShortBody')} onClose={() => setPopup(false)} />
      )}
    </div>
  )
}
