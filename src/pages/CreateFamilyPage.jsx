import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'

export default function CreateFamilyPage() {
  const t = useT()
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
      setError(t('createFamily.notLoggedIn'))
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
      if (!family) throw new Error(t('createFamily.notCreated'))

      await loadFamily(user.id)
      window.location.href = '/profile'
    } catch (err) {
      setError(err.message || t('createFamily.somethingWrong'))
      setLoading(false)
    }
  }

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="auth-logo">👨‍👩‍👧‍👦</div>
        <h1 className="auth-title">{t('createFamily.title')}</h1>
        <p className="auth-subtitle">{t('createFamily.sub')}</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleCreate} noValidate>
          <div className="form-group">
            <label>{t('createFamily.familyName')}</label>
            <input
              className="input"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('createFamily.yourNameInFamily')}</label>
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
            {loading ? t('createFamily.creating') : t('createFamily.create')}
          </button>
        </form>

        <p className="auth-link">
          {t('createFamily.haveCode')} <Link to="/join-family">{t('createFamily.joinFamily')}</Link>
        </p>
      </div>
    </div>
  )
}
