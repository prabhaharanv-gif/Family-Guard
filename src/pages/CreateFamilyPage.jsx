import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function CreateFamilyPage() {
  const [familyName, setFamilyName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { user, loadFamily } = useAuthStore()

  const handleCreate = async (e) => {
    e.preventDefault()
    if (loading) return // prevent double submit
    setError('')

    if (!user || !user.id) {
      setError('You are not logged in. Please log in again.')
      return
    }

    setLoading(true)

    try {
      // SECURE: atomic RPC — creates family + admin membership in one transaction
      // created_by and user_id are forced to auth.uid() server-side
      const { data: family, error: fe } = await supabase.rpc(
        'create_family_with_membership',
        {
          p_family_name:  familyName.trim(),
          p_display_name: displayName.trim(),
        }
      )

      if (fe) throw fe
      if (!family) throw new Error('Family was not created')

      await loadFamily(user.id)
      window.location.href = '/profile'
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="auth-logo">👨‍👩‍👧‍👦</div>
        <h1 className="auth-title">Create Your Family</h1>
        <p className="auth-subtitle">Set up your group to start sharing locations</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleCreate} noValidate>
          <div className="form-group">
            <label>Family Name</label>
            <input
              className="input"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Your Name in the Family</label>
            <input
              className="input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'Creating...' : 'Create Family'}
          </button>
        </form>

        <p className="auth-link">
          Have an invite code? <Link to="/join-family">Join Family</Link>
        </p>
      </div>
    </div>
  )
}
