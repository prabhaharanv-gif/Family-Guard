import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// ── SECURE JoinFamilyPage ────────────────────────────────────────────────────
// The old version did a direct family_members INSERT — bypassing admin approval.
// This version submits a join_request which an admin must explicitly accept.
// The join_request RLS ensures: requester_id = auth.uid() (server-enforced).
// ─────────────────────────────────────────────────────────────────────────────

export default function JoinFamilyPage() {
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
        throw new Error('Invite code must be 4–8 characters.')
      }
      if (!displayName.trim() || displayName.trim().length > 100) {
        throw new Error('Please enter your name (max 100 characters).')
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

      if (re) throw new Error(re.message || 'Failed to send join request')

      setTargetFamily({ name: 'the family' })
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
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Request Sent!</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
            Your request to join <strong>{targetFamily?.name}</strong> has been sent.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
            The family admin will review your request. Once accepted you will be added automatically.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.href = '/profile'}>
            Back to Profile
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
        <h1 className="auth-title">Join a Family</h1>
        <p className="auth-subtitle">Enter the invite code from your family admin</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleJoinRequest} noValidate>
          <div className="form-group">
            <label>Invite Code</label>
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
            <label>Your Name in the Family</label>
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
            {loading ? 'Sending Request...' : 'Send Join Request'}
          </button>
        </form>

        <p className="auth-link">
          Want to create a new family? <Link to="/create-family">Go back</Link>
        </p>
      </div>
    </div>
  )
}
