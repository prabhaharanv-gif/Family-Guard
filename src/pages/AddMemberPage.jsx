import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'

const RELATIONSHIPS = ['Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Spouse', 'Grandfather', 'Grandmother', 'Other']
const AVATAR_COLORS = ['#4F8EF7','#FF6B6B','#34C759','#FF9500','#AF52DE','#FF2D55','#5AC8FA','#FFCC00']

// NOTE: AddMemberPage creates placeholder members.
// Real members join via authenticated invite flow.

export default function AddMemberPage() {
  const t = useT()
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [relationship, setRelationship] = useState('')
  const [betName, setBetName] = useState('')
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { familyId } = useAuthStore()
  const navigate = useNavigate()

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // SECURE: add_family_contact() RPC — server generates UUID, validates admin membership
      const { error } = await supabase.rpc('add_family_contact', {
        p_family_id:    familyId,
        p_display_name: displayName.trim(),
        p_phone:        phone ? `+91${phone}` : null,
        p_relationship: relationship || null,
        p_bet_name:     betName || null,
        p_avatar_color: selectedColor || '#951345',
      })
      if (error) throw error
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="add-member-page">
      <div className="add-member-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>←</button>
          <h2 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.4 }}>{t('addMember.title')}</h2>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleAdd}>
          {/* Avatar color picker */}
          <div className="form-group">
            <label>{t('addMember.avatarColor')}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {AVATAR_COLORS.map(c => (
                <div key={c} onClick={() => setSelectedColor(c)} style={{
                  width: 32, height: 32, borderRadius: '50%', background: c,
                  cursor: 'pointer',
                  border: selectedColor === c ? '3px solid #1A1A2E' : '3px solid transparent',
                  transition: 'border 0.15s',
                }} />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>{t('addMember.fullName')}</label>
            <input className="input" value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required />
          </div>

          <div className="form-group">
            <label>{t('addMember.mobileNumber')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                padding: '13px 10px', background: 'var(--bg)',
                border: '1.5px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap'
              }}>+91</span>
              <input className="input" type="tel" value={phone}
                onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="9876543210" maxLength={10} style={{ flex: 1 }} />
            </div>
          </div>

          <div className="form-group">
            <label>{t('addMember.relationship')}</label>
            <select className="input" value={relationship}
              onChange={e => setRelationship(e.target.value)} required>
              <option value="">{t('addMember.selectRelationship')}</option>
              {/* value stays English: it is what add_family_contact stores. */}
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{t('addMember.rel.' + r)}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>{t('addMember.nickname')}</label>
            <input className="input" value={betName}
              onChange={e => setBetName(e.target.value)}
              />
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? t('addMember.adding') : t('addMember.add')}
          </button>
        </form>
      </div>
    </div>
  )
}
