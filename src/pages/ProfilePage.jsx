import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 52, height: 30, borderRadius: 15,
        background: on
          ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
          : '#D1D5DB',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)', flexShrink: 0,
        boxShadow: on ? '0 2px 8px rgba(16,185,129,0.4)' : 'inset 0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3,
        left: on ? 25 : 3,
        transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

export default function ProfilePage() {
  const { user, familyId, signOut } = useAuthStore()
  const [member, setMember] = useState(null)
  const [joinedFamilyName, setJoinedFamilyName] = useState('')
  const [myInviteCode, setMyInviteCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [showLocation, setShowLocation] = useState(true)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    if (!user || !familyId) return

    setEmail(user.email || '')

    supabase
      .from('family_members')
      .select('*')
      .eq('user_id', user.id)
      .eq('family_id', familyId)
      .single()
      .then(({ data }) => {
        if (data) {
          setMember(data)
          setDisplayName(data.display_name || '')
          setPhone(data.phone ? data.phone.replace('+91', '') : '')
          setAvatarUrl(data.avatar_url || null)
          setShowLocation(data.show_location !== false)
          setShowLastSeen(data.show_last_seen !== false)
        }
      })

    // Load joined family name
    supabase
      .from('family_members')
      .select('family_id, families(id, name, created_by)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const joined = data.find(d => d.families?.created_by !== user.id)
          if (joined) setJoinedFamilyName(joined.families?.name || '')
        }
      })

    // Load the user's OWN family invite code (the family they created)
    supabase
      .from('family_members')
      .select('family_id, families(invite_code, created_by)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) {
          const own = data.find(d => d.families?.created_by === user.id)
          if (own) setMyInviteCode(own.families?.invite_code || '')
        }
      })
  }, [user, familyId])

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Photo must be under 5MB'); return }
    setUploading(true)
    setError('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      // Save clean URL to DB (no cache-buster — it breaks on refresh)
      await supabase.from('family_members').update({ avatar_url: publicUrl })
        .eq('user_id', user.id)
      // Add cache-buster only for local display so new image shows immediately
      setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
    } catch (err) {
      setError('Photo upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!displayName.trim()) { setError('Name cannot be empty'); return }
    setSaving(true)
    setError('')
    try {
      // Update family_members record
      const { error: me } = await supabase
        .from('family_members')
        .update({
          display_name: displayName.trim(),
          phone: phone ? `+91${phone.replace(/[^0-9]/g, '')}` : null,
          show_location: showLocation,
          show_last_seen: showLastSeen,
        })
        .eq('user_id', user.id)
        .eq('family_id', familyId)
      if (me) throw me

      // Update email in Supabase Auth if changed
      if (email.trim() && email.trim() !== user.email) {
        const { error: ae } = await supabase.auth.updateUser({ email: email.trim() })
        if (ae) throw ae
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLeaveFamily = async () => {
    const familyLabel = joinedFamilyName || 'this family'
    if (!window.confirm(`Leave "${familyLabel}"? You will need a new invite code to rejoin.`)) return
    try {
      await supabase.from('family_members').delete()
        .eq('user_id', user.id).eq('family_id', familyId)
      await signOut()
    } catch (err) {
      setError(err.message)
    }
  }

  const initial = displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
  const avatarColor = member?.avatar_color || '#5B6EF5'
  const ownPhone = phone ? `+91 ${phone}` : ''

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top Bar — avatar IN the banner */}
      <div className="top-bar" style={{ alignItems: 'center' }}>
        {/* Avatar in banner */}
        <div style={{ position: 'relative', flexShrink: 0, marginRight: 12 }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" style={{
              width: 44, height: 44, borderRadius: '50%', objectFit: 'cover',
              border: '2px solid rgba(255,255,255,0.5)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: avatarColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 900, color: '#fff',
              border: '2px solid rgba(255,255,255,0.5)',
              fontFamily: 'Sora, sans-serif',
            }}>
              {initial}
            </div>
          )}
          <button
            onClick={() => fileRef.current.click()}
            disabled={uploading}
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 20, height: 20, borderRadius: '50%',
              background: 'var(--blue)', border: '1.5px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 10,
            }}
          >
            {uploading ? '⏳' : '📷'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
        </div>

        <div style={{ flex: 1 }}>
          <div className="top-bar-title">{displayName || 'My Profile'}</div>
          {ownPhone && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1, fontWeight: 600 }}>
              {ownPhone}
            </div>
          )}
        </div>

        <button
          onClick={() => { if (window.confirm('Sign out of FamilyGuard?')) signOut() }}
          style={{
            background: 'rgba(245,59,87,0.18)',
            border: '1px solid rgba(245,59,87,0.35)',
            color: '#FF6B80',
            borderRadius: 10,
            padding: '7px 14px',
            fontWeight: 700, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Sign Out
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

        {uploading && (
          <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 8, marginBottom: 8, fontWeight: 600, textAlign: 'center' }}>
            Uploading photo...
          </div>
        )}

        {error && <div className="error-msg">{error}</div>}

        {saved && (
          <div style={{
            background: 'var(--green-light)', border: '1px solid var(--green)',
            color: 'var(--green)', padding: '10px 14px', borderRadius: 12,
            fontSize: 13, fontWeight: 700, marginBottom: 12, textAlign: 'center',
          }}>
            ✅ Profile saved!
          </div>
        )}

        {/* Edit Info */}
        <div className="settings-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Edit Info
          </div>

          <div className="form-group">
            <label>Display Name</label>
            <input className="input" value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name in the family" />
          </div>

          <div className="form-group">
            <label>Mobile Number</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                padding: '13px 10px', background: 'var(--bg)',
                border: '1.5px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
              }}>🇮🇳 +91</span>
              <input className="input" type="tel" value={phone}
                onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="9876543210" maxLength={10} style={{ flex: 1 }} />
            </div>
          </div>

          {/* Editable Email */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" />
            {email !== user?.email && (
              <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 4, fontWeight: 600 }}>
                ⚠️ A confirmation link will be sent to the new email
              </div>
            )}
          </div>
        </div>

        {/* My Code */}
        {myInviteCode && (
          <div className="settings-card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              My Family Code
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 6, color: 'var(--blue)' }}>
                {myInviteCode}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(myInviteCode); alert('Code copied!') }}
                style={{
                  background: 'var(--blue-light)', border: 'none', borderRadius: 10,
                  padding: '7px 12px', color: 'var(--blue)', fontWeight: 700,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                📋 Copy
              </button>
            </div>
            {joinedFamilyName && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text2)' }}>
                Joined Family: <strong style={{ color: 'var(--blue)' }}>{joinedFamilyName}</strong>
              </div>
            )}
          </div>
        )}

        {/* Privacy Toggles */}
        <div className="settings-card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
            Privacy
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>📍 Show My Location</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {showLocation ? 'Visible to family on map' : 'Hidden from family map'}
              </div>
            </div>
            <Toggle on={showLocation} onToggle={() => setShowLocation(p => !p)} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>🕐 Show Last Seen</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {showLastSeen ? 'Family can see your last active time' : 'Last seen hidden from family'}
              </div>
            </div>
            <Toggle on={showLastSeen} onToggle={() => setShowLastSeen(p => !p)} />
          </div>
        </div>

        {/* Save */}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginBottom: 12 }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        {/* Leave Family */}
        <button
          onClick={handleLeaveFamily}
          style={{
            width: '100%', padding: 15, borderRadius: 16,
            background: 'linear-gradient(135deg, #FFF8F0 0%, #FEF3C7 100%)',
            border: '1.5px solid rgba(245,158,11,0.3)',
            color: '#D97706', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(245,158,11,0.12)',
          }}
        >
          🚪 Leave Family
        </button>

      </div>
    </div>
  )
}
