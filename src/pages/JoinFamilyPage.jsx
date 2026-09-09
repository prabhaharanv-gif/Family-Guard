import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'

// ── SECURE JoinFamilyPage ────────────────────────────────────────────────────
// The old version did a direct family_members INSERT — bypassing admin approval.
// This version submits a join_request which an admin must explicitly accept.
// The join_request RLS ensures: requester_id = auth.uid() (server-enforced).
// ─────────────────────────────────────────────────────────────────────────────

export default function JoinFamilyPage() {
  const t = useT()
  const [code, setCode]           = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [requested, setRequested] = useState(false)
  const [targetFamily, setTargetFamily] = useState(null)
  const { user, familyId }        = useAuthStore()

  const handleJoinRequest = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // ── Input validation ─────────────────────────────────────────────────
      const trimCode = code.toUpperCase().trim()
      if (trimCode.length < 4 || trimCode.length > 8) {
        throw new Error(t('join.codeLength'))
      }
      if (!displayName.trim() || displayName.trim().length > 100) {
        throw new Error(t('join.enterYourName'))
      }

      // ── Look up the family by invite code ─────────────────────────────
      // ── SECURE: submit_join_request() RPC ──────────────────────────────
      // All validation done server-side:
      //   - family lookup by invite_code
      //   - not already a member
      //   - no duplicate pending request
      //   - requester_id = auth.uid() (never from client)
      const { error: re } = await supabase.rpc('submit_join_request', {
        p_invite_code:    trimCode,
        p_requester_name: displayName.trim(),
      })

      // "You already have a pending request" is not a failure — it is the state
      // the user was trying to reach. Reported as an error it reads as though
      // nothing was sent, while the admin is looking at the request on their
      // screen, so the natural response is to try again and see the same error.
      //
      // It happens whenever a request was sent earlier, and also when the first
      // call inserted the row but its response never made it back. Treating the
      // outcome rather than the call as what matters makes submitting twice
      // harmless.
      if (re && !/pending request/i.test(re.message || '')) {
        throw new Error(re.message || t('onboarding.failedJoinRequest'))
      }

      setTargetFamily({ name: t('join.theFamily') })
      setRequested(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (requested) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⏳</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{t('onboarding.requestSent')}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
            {t('onboarding.requestSentBody', { family: targetFamily?.name })}
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
            {t('join.adminWillReview')}
          </p>
          <button className="btn btn-primary" onClick={() => window.location.href = '/profile'}>
            {t('join.backToProfile')}
          </button>
        </div>
      </div>
    )
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="auth-logo">🔑</div>
        <h1 className="auth-title">{t('join.title')}</h1>
        <p className="auth-subtitle">{t('join.sub')}</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleJoinRequest} noValidate>
          <div className="form-group">
            <label>{t('join.inviteCode')}</label>
            <input
              className="input"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={8}
              style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 8 }}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('join.yourNameInFamily')}</label>
            <input
              className="input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={100}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit"
            disabled={loading || code.length < 4 || !displayName.trim()}
            style={{ marginTop: 8 }}>
            {loading ? t('onboarding.sendingRequest') : t('onboarding.sendJoinRequest')}
          </button>
        </form>

        <p className="auth-link">
          {t('join.wantCreate')} <Link to="/create-family">{t('join.goBack')}</Link>
        </p>
      </div>
    </div>
  )
}
