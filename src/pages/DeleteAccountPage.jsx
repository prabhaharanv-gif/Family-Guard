/**
 * DeleteAccountPage
 *
 * The public account-deletion route. Google Play requires a way to request
 * deletion from the open web — reachable without installing the app — so this
 * sits outside PrivateRoute, and ConsentGate already lets signed-out visitors
 * through. Someone who has uninstalled Famora can still land here and act.
 *
 * It offers two routes: the in-app Profile → Delete My Account, and deleting
 * right here. The web route proves ownership the only way this app can — an SMS
 * code to the registered number — then asks for DELETE to be typed, the same
 * confirmation the in-app path uses, before calling delete_my_account().
 */

import { useEffect, useRef, useState } from 'react'
import { withCaptcha } from '../lib/captcha'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { useT } from '../i18n'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'

/**
 * A throwaway client for the web deletion flow only.
 *
 * Signing in through the app's shared client would hand the session to the
 * whole app: ConsentGate would put its policy screen over this page, and
 * useSingleDevice would claim the account for this browser. This one keeps its
 * session in memory under its own storage key, so none of that ever sees it and
 * nothing survives closing the tab.
 */
let deleteClient = null
function getDeleteClient() {
  if (!deleteClient) {
    deleteClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: 'famora-web-delete',
        },
      },
    )
  }
  return deleteClient
}

const toE164 = (mobile) => `+91${mobile.replace(/[^0-9]/g, '')}`

function Card({ title, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '16px 18px',
      marginBottom: 12, border: '1.5px solid var(--border)',
      boxShadow: '0 2px 12px rgba(139,13,61,0.06)',
    }}>
      <div style={{
        fontSize: 14, fontWeight: 800, color: 'var(--maroon)',
        fontFamily: 'Sora, sans-serif', marginBottom: 6, lineHeight: 1.4,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13.5, color: '#3A1020', lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  )
}

const primaryBtn = (enabled) => ({
  flex: 2, padding: 13, borderRadius: 14,
  background: enabled ? 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))' : '#D9C7CF',
  border: 'none', color: '#fff', fontWeight: 800,
  cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 14,
})

const secondaryBtn = {
  flex: 1, padding: 13, borderRadius: 14, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
}

function WebDeleteFlow() {
  const t = useT()
  const [step, setStep] = useState(1)          // 1 number, 2 code, 3 confirm, 4 done
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const timer = useRef(null)

  useEffect(() => {
    if (resendIn <= 0) return
    timer.current = setTimeout(() => setResendIn(n => n - 1), 1000)
    return () => clearTimeout(timer.current)
  }, [resendIn])

  const digits = mobile.replace(/[^0-9]/g, '')

  const sendCode = async () => {
    setError('')
    if (digits.length !== 10) { setError(t('auth.enterValidMobile')); return }
    setLoading(true)
    // shouldCreateUser: false — without it, asking for a code for a number that
    // has no account would quietly create one, the way registration relies on.
    const { error: otpErr } = await getDeleteClient().auth.signInWithOtp({
      phone: toE164(mobile),
      options: await withCaptcha({ shouldCreateUser: false }),
    })
    setLoading(false)
    if (otpErr) { setError(t('deletePage.couldNotSend')); return }
    setOtp('')
    setStep(2)
    setResendIn(30)
  }

  const verifyCode = async () => {
    setError('')
    if (otp.length !== 6) { setError(t('reset.enterSixDigit')); return }
    setLoading(true)
    const { data, error: verifyErr } = await getDeleteClient().auth.verifyOtp({
      phone: toE164(mobile), token: otp, type: 'sms',
    })
    setLoading(false)
    if (verifyErr || !data?.session) { setError(t('reset.incorrectCode')); return }
    setConfirmText('')
    setStep(3)
  }

  const deleteAccount = async () => {
    setError('')
    setLoading(true)
    const client = getDeleteClient()
    const { error: rpcErr } = await client.rpc('delete_my_account')
    if (rpcErr) {
      setLoading(false)
      setError(t('deletePage.deleteFailed'))
      return
    }
    // The account no longer exists, so this may be refused; it only clears the
    // in-memory session either way.
    try { await client.auth.signOut() } catch {}
    setLoading(false)
    setStep(4)
  }

  const cancel = async () => {
    try { await getDeleteClient().auth.signOut() } catch {}
    setStep(1); setOtp(''); setConfirmText(''); setError('')
  }

  if (step === 4) {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ marginBottom: 8 }}><Icon name="checkCircle" size={40} color="#16A34A" /></div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#16A34A', marginBottom: 6 }}>
          {t('deletePage.deletedTitle')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('deletePage.deletedBody')}</div>
      </div>
    )
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        {step === 1 && t('deletePage.optionWebBody')}
        {step === 2 && t('reset.step2Sub', { mobile: digits })}
        {step === 3 && t('deletePage.confirmBody')}
      </div>

      {error && <Dialog type="info" message={error} onClose={() => setError('')} />}

      {step === 1 && (
        <>
          <input className="input" type="tel" inputMode="numeric" value={mobile}
            onChange={e => setMobile(e.target.value)}
            placeholder={t('auth.mobileNumber')}
            style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex' }}>
            <button onClick={sendCode} disabled={loading} style={primaryBtn(!loading)}>
              {loading ? t('profile.sending') : t('profile.sendCode')}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <input className="input" type="text" inputMode="numeric" value={otp} autoFocus
            onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder={t('reset.sixDigitCode')}
            style={{ marginBottom: 12, textAlign: 'center', fontSize: 22, fontWeight: 800, letterSpacing: 6 }} />
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button onClick={cancel} style={secondaryBtn}>← {t('common.back')}</button>
            <button onClick={verifyCode} disabled={loading || otp.length !== 6}
              style={primaryBtn(!loading && otp.length === 6)}>
              {loading ? t('reset.verifying') : t('reset.verify') + ' →'}
            </button>
          </div>
          <button onClick={sendCode} disabled={resendIn > 0 || loading} style={{
            display: 'block', margin: '0 auto', background: 'none', border: 'none',
            fontWeight: 700, fontSize: 13, padding: 0, fontFamily: 'inherit',
            color: resendIn > 0 ? 'var(--muted3)' : 'var(--maroon)',
            cursor: resendIn > 0 ? 'default' : 'pointer',
          }}>{resendIn > 0 ? t('reset.resendIn', { n: resendIn }) : t('reset.resendCode')}</button>
        </>
      )}

      {step === 3 && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#7F1D1D', marginBottom: 6 }}>
            {t('profile.typeToConfirm', { word: 'DELETE' })}
          </div>
          <input className="input" value={confirmText} autoFocus
            onChange={e => setConfirmText(e.target.value)}
            placeholder={t('profile.typeDeleteHere')}
            style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={cancel} style={secondaryBtn}>{t('common.cancel')}</button>
            <button onClick={deleteAccount}
              disabled={loading || confirmText.trim() !== 'DELETE'}
              style={{
                ...primaryBtn(!loading && confirmText.trim() === 'DELETE'),
                background: !loading && confirmText.trim() === 'DELETE' ? '#DC2626' : '#E5C9C9',
              }}>
              {loading ? t('profile.deleting') : t('profile.deleteForever')}
            </button>
          </div>
        </>
      )}
    </>
  )
}

export default function DeleteAccountPage() {
  const navigate = useNavigate()
  const t = useT()

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      zIndex: 100,
    }}>
      {/* Header — same shape as PrivacyPolicyPage so the two public pages match */}
      <div style={{
        background: 'linear-gradient(135deg, var(--maroon) 0%, var(--maroon-deep) 100%)',
        padding: '16px 16px 20px',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(139,13,61,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Goes to the app root rather than back: this page is usually opened
              from a store listing or an email, where there is no history. */}
          <button onClick={() => navigate('/')} aria-label={t('deletePage.backToApp')} style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, width: 36, height: 36,
            cursor: 'pointer', fontSize: 18, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontFamily: 'inherit',
          }}><Icon name="arrowLeft" size={18} /></button>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, color: '#fff',
              fontFamily: 'Sora, sans-serif', lineHeight: 1.35,
            }}>
              {t('deletePage.title')}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.82)', marginTop: 2, lineHeight: 1.5 }}>
              {t('deletePage.sub')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 40px' }}>

        {/* Warning — deletion is irreversible, said before the how-to */}
        <div style={{
          background: '#FEF2F2', border: '1.5px solid #FCA5A5',
          borderRadius: 16, padding: '14px 16px', marginBottom: 14,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ flexShrink: 0, display: 'flex', paddingTop: 2 }}><Icon name="alert" size={22} color="#DC2626" /></span>
          <div style={{ fontSize: 13.5, color: '#7F1D1D', lineHeight: 1.6, fontWeight: 600 }}>
            {t('deletePage.cannotUndo')}
          </div>
        </div>

        <Card title={t('deletePage.optionInApp')}>
          {t('deletePage.optionInAppBody')}
        </Card>

        <Card title={t('deletePage.optionWeb')}>
          <WebDeleteFlow />
        </Card>

        <Card title={t('deletePage.whatGoes')}>
          {t('deletePage.whatGoesBody')}
        </Card>

        <Card title={t('deletePage.whatStays')}>
          {t('deletePage.whatStaysBody')}
        </Card>

        <button onClick={() => navigate('/')} style={{
          width: '100%', padding: 14, borderRadius: 14, marginTop: 4,
          background: 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))', border: 'none',
          color: '#fff', fontWeight: 700, fontSize: 14.5,
          fontFamily: 'inherit', cursor: 'pointer',
        }}>
          {t('deletePage.backToApp')}
        </button>
      </div>
    </div>
  )
}
