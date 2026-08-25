import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import Dialog from '../components/Dialog'

export default function OnboardingPage() {
  const { user, familyId, inviteCode } = useAuthStore()
  const [step, setStep] = useState('choice')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requested, setRequested] = useState(false)
  const [targetFamily, setTargetFamily] = useState(null)
  const [dialog, setDialog] = useState(null)

  const handleJoinRequest = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // SECURE: submit_join_request RPC handles all validation server-side
      // (family lookup, membership check, duplicate prevention)
      const { error: re } = await supabase.rpc('submit_join_request', {
        p_invite_code:    joinCode.toUpperCase().trim(),
        p_requester_name: user.user_metadata?.display_name || 'Family Member',
      })
      if (re) throw new Error(re.message || 'Failed to send join request')

      setTargetFamily(family)
      setRequested(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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
            The family admin will accept your request. Once accepted, you'll see the full family.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.href = '/'}>
            Go to My Family
          </button>
        </div>
      </div>
    )
  }

  if (step === 'join') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <button onClick={() => setStep('choice')} style={{
            background: 'none', border: 'none', fontSize: 20,
            cursor: 'pointer', marginBottom: 16, color: 'var(--muted)'
          }}>← Back</button>

          <div className="auth-logo">🔑</div>
          <h1 className="auth-title">Join a Family</h1>
          <p className="auth-subtitle">Enter the invite code shared by your family admin</p>

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleJoinRequest} noValidate>
            <div className="form-group">
              <label>Family Invite Code</label>
              <input className="input" value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD" maxLength={6}
                style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 8 }}
                required />
            </div>
            <button className="btn btn-primary" type="submit"
              disabled={loading || joinCode.length < 6} style={{ marginTop: 8 }}>
              {loading ? 'Sending Request...' : 'Send Join Request'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🛡️</div>
        <h1 className="auth-title">Welcome!</h1>
        <p className="auth-subtitle">How would you like to get started?</p>

        <div style={{
          background: 'var(--blue-light)', borderRadius: 16,
          padding: 20, textAlign: 'center', marginBottom: 24,
          border: '1.5px solid var(--blue)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            Your Family Code
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 8, color: 'var(--text)', marginBottom: 6 }}>
            {inviteCode}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Share this with family members so they can join you
          </div>
          <button onClick={() => { navigator.clipboard.writeText(inviteCode); setDialog({ type: 'alert', title: 'Code Copied', message: 'Share this code with your family members so they can join.' }) }}
            style={{
              marginTop: 12, background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', color: '#fff',
              border: 'none', borderRadius: 10, padding: '10px 24px',
              fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              boxShadow: '0 4px 14px rgba(79,70,229,0.35)',
            }}>📋 Copy Code</button>
        </div>

        <button className="btn btn-primary" onClick={() => window.location.href = '/'} style={{ marginBottom: 12 }}>
          👨‍👩‍👧‍👦 Go to My Family
        </button>

        <button className="btn btn-outline" onClick={() => setStep('join')}>
          🔑 Join Another Family
        </button>
      </div>

      {dialog && (
        <Dialog
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
