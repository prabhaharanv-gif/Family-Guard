import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { createOwnFamily } = useAuthStore()

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email, password,
        options: { data: { display_name: name } },
      })

      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Registration failed')

      // Auto-create own family
      await createOwnFamily(data.user.id, name)

      // Go to onboarding choice
      window.location.href = '/onboarding'
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🛡️</div>
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-subtitle">Join FamilyGuard to keep your family safe</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleRegister} noValidate>
          <div className="form-group">
            <label>Your Name</label>
            <input className="input" type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Prabhakaran" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min 6 characters" required />
          </div>
          <button className="btn btn-primary" type="submit"
            disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
