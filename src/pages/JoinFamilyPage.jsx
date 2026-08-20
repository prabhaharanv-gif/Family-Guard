import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function JoinFamilyPage() {
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { user, loadFamily } = useAuthStore()
  const navigate = useNavigate()

  const handleJoin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: family, error: fe } = await supabase
        .from('families').select('id, name')
        .eq('invite_code', code.toUpperCase().trim()).single()
      if (fe || !family) throw new Error('Invalid invite code. Please check and try again.')

      const { error: me } = await supabase.from('family_members').insert({
        family_id: family.id, user_id: user.id,
        display_name: displayName, role: 'member',
      })
      if (me) throw me

      await loadFamily(user.id)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="auth-logo">🔑</div>
        <h1 className="auth-title">Join a Family</h1>
        <p className="auth-subtitle">Enter the invite code from your family admin</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleJoin}>
          <div className="form-group">
            <label>Invite Code</label>
            <input className="input" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123" maxLength={6}
              style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 8 }}
              required />
          </div>
          <div className="form-group">
            <label>Your Name in the group</label>
            <input className="input" value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Mum" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Joining...' : 'Join Family'}
          </button>
        </form>

        <p className="auth-link">
          Want to create a new family? <Link to="/create-family">Go back</Link>
        </p>
      </div>
    </div>
  )
}
