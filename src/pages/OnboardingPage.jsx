import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'

export default function OnboardingPage() {
  const { user, familyId, inviteCode } = useAuthStore()
  const [step, setStep] = useState('choice')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requested, setRequested] = useState(false)
  const [targetFamily, setTargetFamily] = useState(null)

  const handleJoinRequest = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data: family, error: fe } = await supabase
        .from('families')
        .select('id, name')
        .eq('invite_code', joinCode.toUpperCase().trim())
        .single()

      if (fe || !family) throw new Error('Invalid invite code. Please check and try again.')
      if (family.id === familyId) throw new Error('This is your own family code!')

      const { error: re } = await supabase.from('join_requests').insert({
        family_id: family.id,
        requester_id: user.id,
        requester_name: user.user_metadata?.display_name || 'Family Member',
      })

      if (re) throw re

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
        <p className="auth-subtitle">What would you like to do?</p>

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
          <button onClick={() => { navigator.clipboard.writeText(inviteCode); alert('Code copied!') }}
            style={{
              marginTop: 12, background: 'var(--blue)', color: '#fff',
              border: 'none', borderRadius: 8, padding: '8px 20px',
              fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
            }}>📋 Copy Code</button>
        </div>

        <button className="btn btn-primary" onClick={() => window.location.href = '/'} style={{ marginBottom: 12 }}>
          👨‍👩‍👧‍👦 Go to My Family
        </button>

        <button className="btn btn-outline" onClick={() => setStep('join')}>
          🔑 Join Another Family
        </button>
      </div>
    </div>
  )
}
