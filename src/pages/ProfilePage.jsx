import { useState, useEffect, useRef } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
const LocationService = registerPlugin('LocationService')
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import { useBackButton } from '../hooks/useBackButton'

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 46, height: 26, borderRadius: 13,
        background: on ? '#059669' : '#D1D5DB',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'all 0.25s', flexShrink: 0,
        boxShadow: on ? '0 2px 8px rgba(16,185,129,0.4)' : 'none',
      }}
    >
      <div style={{
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3,
        left: on ? 23 : 3,
        transition: 'left 0.25s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

// ── Change password modal ──
function ChangePasswordModal({ onClose, userEmail }) {
  const [oldPw, setOldPw]       = useState('')
  const [pw, setPw]             = useState('')
  const [confirm, setConfirm]   = useState('')
  const [show, setShow]         = useState(false)   // current password
  const [showNew, setShowNew]   = useState(false)   // new password
  const [showConf, setShowConf] = useState(false)   // confirm password
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')
  const [ok, setOk]             = useState(false)

  useBackButton(true, onClose)

  const EyeIcon = ({ off }) => off
    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M9.88 9.88a3 3 0 0 0 4.24 4.24" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>

  const handleSave = async () => {
    setErr('')
    if (!oldPw) { setErr('Please enter your current password'); return }
    if (pw.length < 6) { setErr('New password must be at least 6 characters'); return }
    if (pw !== confirm) { setErr('New passwords do not match'); return }
    if (pw === oldPw) { setErr('New password must be different from current password'); return }
    setBusy(true)
    // Verify old password by re-signing in
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: oldPw })
    if (signInErr) { setBusy(false); setErr('Current password is incorrect'); return }
    // Update to new password
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 14 }}>
          Change Password
        </div>

        {ok ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#059669', fontWeight: 700 }}>
            ✓ Password updated
          </div>
        ) : (
          <>
            {err && <div className="error-msg" style={{ marginBottom: 12 }}>{err}</div>}

            {/* Current password */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                className="input" type={show ? 'text' : 'password'} value={oldPw} autoFocus
                onChange={e => setOldPw(e.target.value)}
                placeholder="Current password"
                style={{ paddingRight: 44 }}
              />
              <button type="button" onClick={() => setShow(s => !s)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <EyeIcon off={!show} />
              </button>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: '#F0E4EA', margin: '4px 0 12px' }} />

            {/* New password */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                className="input" type={showNew ? 'text' : 'password'} value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="New password"
                style={{ paddingRight: 44 }}
              />
              <button type="button" onClick={() => setShowNew(s => !s)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <EyeIcon off={!showNew} />
              </button>
            </div>

            {/* Confirm password */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input
                className="input" type={showConf ? 'text' : 'password'} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="Confirm new password"
                style={{ paddingRight: 44 }}
              />
              <button type="button" onClick={() => setShowConf(s => !s)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <EyeIcon off={!showConf} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: '#F5F4FB', border: '1px solid #E9E6FB',
                color: '#3A1020', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
              }}>Cancel</button>
              <button onClick={handleSave} disabled={busy} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: '#951345', border: 'none',
                color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 14,
              }}>{busy ? 'Verifying...' : 'Update'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Delete account confirmation modal ──
function DeleteAccountModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const CONFIRM_WORD = 'DELETE'

  useBackButton(true, onClose)

  const handleDelete = async () => {
    if (confirmText !== CONFIRM_WORD) return
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />

        {/* Warning notification banner */}
        <div style={{
          background: '#FEF2F2', border: '1.5px solid #FCA5A5',
          borderRadius: 14, padding: '14px 16px', marginBottom: 20,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#DC2626', marginBottom: 4 }}>
              Delete My Account
            </div>
            <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.5 }}>
              Permanently delete your account and all your data. This cannot be undone.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 6 }}>
            Type <strong>DELETE</strong> to confirm
          </div>
          <input
            className="input"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value.toUpperCase())}
            placeholder="Type DELETE here"
            autoFocus
            style={{ textAlign: 'center', fontWeight: 800, letterSpacing: 3, fontSize: 15 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#F5F4FB', border: '1px solid #E9E6FB',
            color: '#3A1020', fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14,
          }}>Cancel</button>
          <button
            onClick={handleDelete}
            disabled={confirmText !== CONFIRM_WORD || deleting}
            style={{
              flex: 1, padding: 14, borderRadius: 14,
              background: confirmText === CONFIRM_WORD ? '#DC2626' : '#FCA5A5',
              border: 'none', color: '#fff', fontWeight: 800,
              cursor: confirmText === CONFIRM_WORD ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 14,
              transition: 'background 0.2s',
            }}
          >
            {deleting ? 'Deleting...' : 'Delete Forever'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const { user, familyId, familyName: activeFamilyName, allFamilies, leaveFamily, switchFamily, loadFamily, signOut } = useAuthStore()
  const navigate = useNavigate()

  const [member, setMember]             = useState(null)
  const [myFamilyName, setMyFamilyName] = useState('')
  const [myInviteCode, setMyInviteCode] = useState('')

  const [displayName, setDisplayName]   = useState('')
  const [phone, setPhone]               = useState('')
  const [email, setEmail]               = useState('')
  const [avatarUrl, setAvatarUrl]       = useState(null)
  const [showLocation, setShowLocation] = useState(true)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [showOnline, setShowOnline]     = useState(true)
  const [savingToggle, setSavingToggle] = useState(false)

  const [uploading, setUploading]       = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [error, setError]               = useState('')
  const [showPwModal, setShowPwModal]           = useState(false)
  const [showDeleteModal, setShowDeleteModal]   = useState(false)
  const [showInviteSheet, setShowInviteSheet]   = useState(false)
  const [codeCopied, setCodeCopied]             = useState(false)
  const [selectedFam, setSelectedFam]           = useState(null) // family action sheet
  const fileRef = useRef()

  // Hardware back button closes open sheets instead of exiting the app
  useBackButton(showInviteSheet, () => setShowInviteSheet(false))
  useBackButton(!!selectedFam, () => setSelectedFam(null))

  const loadProfile = async () => {
    if (!user || !familyId) return
    setEmail(user.email || '')

    // Load all my member records (all families)
    const { data: allMemberRows } = await supabase.from('family_members').select('*')
      .eq('user_id', user.id)

    // Active family row
    const data = allMemberRows?.find(r => r.family_id === familyId)
    // Any other row we can borrow privacy settings from
    const fallback = allMemberRows?.find(r => r.family_id !== familyId)

    if (data) {
      setMember(data)
      setDisplayName(data.display_name || '')
      const savedPhone = data.phone ? data.phone.replace('+91', '') : ''
      const regFromEmail = (user?.email || '').match(/^91(\d{10})@familyguard\.app$/)
      setPhone(savedPhone || (regFromEmail ? regFromEmail[1] : ''))
      setAvatarUrl(data.avatar_url ? `${data.avatar_url}?t=${Date.now()}` : null)

      // If this row's privacy fields are null (new family), seed from another family's row
      const src = (data.show_location !== null) ? data : (fallback || data)
      setShowLastSeen(src.show_last_seen !== false)
      setShowOnline(src.show_online !== false)
      setShowLocation(src.show_location !== false)
    }

    // Load all families I'm in → find the active family name
    const { data: fams } = await supabase.from('family_members')
      .select('family_id, families(id, name, invite_code, created_by)')
      .eq('user_id', user.id)
    if (fams && fams.length > 0) {
      const own    = fams.find(d => d.families?.created_by === user.id)
      const joined = fams.find(d => d.families && d.families.created_by !== user.id)

      // Try to get the family creator's invite code first
      if (own && own.families?.invite_code) {
        setMyInviteCode(own.families.invite_code)
      } else {
        const { data: fam } = await supabase.from('families').select('invite_code, name')
          .eq('created_by', user.id).limit(1).maybeSingle()
        if (fam?.invite_code) {
          setMyInviteCode(fam.invite_code)
        } else {
          // Fallback: derive a stable personal code from the user's UUID
          // First 6 chars of UUID (hex), uppercased — always unique per user
          const uid = user.id.replace(/-/g, '')
          setMyInviteCode(uid.substring(0, 6).toUpperCase())
        }
      }

      const active = fams.find(d => d.family_id === familyId && d.families?.name)
      const chosen = active || joined || own
      if (chosen && chosen.families?.name) setMyFamilyName(chosen.families.name)
    } else {
      // User has no family yet — still show their personal code
      const uid = user.id.replace(/-/g, '')
      setMyInviteCode(uid.substring(0, 6).toUpperCase())
    }
  }

  useEffect(() => {
    loadProfile()
  }, [user, familyId])

  const handlePhotoChange = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Photo must be under 5MB'); return }
    setUploading(true); setError('')
    try {
      // Derive a safe extension from the MIME type (Android file names are unreliable)
      const mime = file.type || 'image/jpeg'
      const extMap = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'jpg', 'image/heif': 'jpg' }
      const ext = extMap[mime] || 'jpg'
      const path = `${user.id}/avatar.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: mime, cacheControl: '3600' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

      // Apply avatar to ALL of the user's family memberships via SECURITY DEFINER RPC
      // (bypasses per-family RLS so joined families get it too)
      let { error: syncErr } = await supabase.rpc('sync_avatar_all_families', {
        p_avatar_url: publicUrl,
      })

      // Fallback 1: direct bulk update
      if (syncErr) {
        const { error: bulkErr } = await supabase.from('family_members')
          .update({ avatar_url: publicUrl }).eq('user_id', user.id)
        // Fallback 2: at least the active family via its RPC
        if (bulkErr) {
          await supabase.rpc('update_member_avatar', {
            p_family_id: familyId, p_avatar_url: publicUrl,
          })
        }
      }

      setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
    } catch (err) {
      setError('Upload failed: ' + (err?.message || 'unknown error'))
    } finally {
      setUploading(false)
      // reset the input so selecting the SAME file again still fires onChange
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSave = async () => {
    if (!displayName.trim()) { setError('Name cannot be empty'); return }
    setSaving(true); setError('')
    try {
      const cleanPhone = phone ? `+91${phone.replace(/[^0-9]/g, '')}` : null

      // Profile (name + phone) across all families — RPC first, bulk fallback
      const { error: profErr } = await supabase.rpc('sync_profile_all_families', {
        p_display_name: displayName.trim(),
        p_phone:        cleanPhone,
      })
      if (profErr) {
        await supabase.from('family_members')
          .update({ display_name: displayName.trim(), phone: cleanPhone })
          .eq('user_id', user.id)
      }

      // Privacy across all families
      const { error: privErr } = await supabase.rpc('sync_privacy_all_families', {
        p_show_location:  showLocation,
        p_show_online:    showOnline,
        p_show_last_seen: showLastSeen,
      })
      if (privErr) {
        await supabase.from('family_members')
          .update({ show_location: showLocation, show_online: showOnline, show_last_seen: showLastSeen })
          .eq('user_id', user.id)
      }

      // Location sharing flag across all families (creates missing rows)
      const { error: locErr } = await supabase.rpc('sync_location_sharing_all_families', {
        p_is_sharing: showLocation,
      })
      // Stop background location service when user disables location sharing
      if (!showLocation && Capacitor.isNativePlatform()) {
        try { await LocationService.stop() } catch (e) {}
      }

      if (locErr) {
        for (const fam of allFamilies) {
          await supabase.rpc('upsert_location', {
            p_family_id: fam.family_id, p_lat: 0, p_lng: 0, p_is_sharing: showLocation,
          }).catch(() => {})
        }
      }

      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const handleToggleLocation = async () => {
    const newVal = !showLocation
    setShowLocation(newVal)          // optimistic UI (self-saving)
    setError('')
    try {
      // Privacy across all families
      const { error: pe } = await supabase.rpc('sync_privacy_all_families', {
        p_show_location: newVal, p_show_online: showOnline, p_show_last_seen: showLastSeen,
      })
      if (pe) {
        await supabase.from('family_members')
          .update({ show_location: newVal }).eq('user_id', user.id)
      }
      // is_sharing across all families
      const { error: le } = await supabase.rpc('sync_location_sharing_all_families', {
        p_is_sharing: newVal,
      })
      if (le) {
        for (const fam of allFamilies) {
          await supabase.rpc('upsert_location', {
            p_family_id: fam.family_id, p_lat: 0, p_lng: 0, p_is_sharing: newVal,
          }).catch(() => {})
        }
      }
    } catch (err) {
      setShowLocation(!newVal)       // revert UI on failure
      setError(err.message)
    }
  }

  const handleToggleOnline = async () => {
    const newVal = !showOnline
    setShowOnline(newVal)
    setError('')
    try {
      const { error: pe } = await supabase.rpc('sync_privacy_all_families', {
        p_show_location: showLocation, p_show_online: newVal, p_show_last_seen: showLastSeen,
      })
      if (pe) {
        await supabase.from('family_members')
          .update({ show_online: newVal }).eq('user_id', user.id)
      }
    } catch (err) {
      setShowOnline(!newVal)
      setError(err.message)
    }
  }

  const handleToggleLastSeen = async () => {
    const newVal = !showLastSeen
    setShowLastSeen(newVal)
    setError('')
    try {
      const { error: pe } = await supabase.rpc('sync_privacy_all_families', {
        p_show_location: showLocation, p_show_online: showOnline, p_show_last_seen: newVal,
      })
      if (pe) {
        await supabase.from('family_members')
          .update({ show_last_seen: newVal }).eq('user_id', user.id)
      }
    } catch (err) {
      setShowLastSeen(!newVal)
      setError(err.message)
    }
  }

  const handleLeaveFamily = async () => {
    const label = myFamilyName || familyId || 'this family'
    if (!window.confirm('Do You Want To Leave From Your Sweet Family? 💔')) return
    try { await leaveFamily(user.id, familyId); navigate('/onboarding') }
    catch (err) { setError(err.message) }
  }

  const initial = displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
  const avatarColor = member?.avatar_color || '#951345'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <div className="top-bar" style={{ alignItems: 'center' }}>
        <div
          onClick={() => { if (!uploading) fileRef.current && fileRef.current.click() }}
          title="Tap to change photo"
          style={{ position: 'relative', flexShrink: 0, marginRight: 12, cursor: uploading ? 'wait' : 'pointer' }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" style={{
              width: 40, height: 40, borderRadius: '50%', objectFit: 'cover',
              border: '2px solid rgba(255,255,255,0.5)',
            }} />
          ) : (
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: avatarColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 900, color: '#fff', fontFamily: 'Sora, sans-serif',
              border: '2px solid rgba(255,255,255,0.5)',
            }}>{initial}</div>
          )}
          {/* Small edit badge so users know the circle is tappable */}
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 16, height: 16, borderRadius: '50%',
            background: '#fff', border: '1.5px solid #951345',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, lineHeight: 1,
          }}>
            {uploading ? '⏳' : '✎'}
          </div>
          {/* Dim overlay while uploading */}
          {uploading && (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} />
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
        </div>

        <div style={{ flex: 1 }}>
          <div className="top-bar-title" style={{ fontSize: 16 }}>{displayName || 'My Profile'}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { if (window.confirm('Sign out?')) signOut() }} style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1.5px solid #fff',
            color: '#951345', borderRadius: 10,
            padding: '7px 14px', fontWeight: 800, fontSize: 12,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <PullToRefresh onRefresh={loadProfile}>
      <div style={{ padding: '12px 14px 20px' }}>

        {error && <div className="error-msg">{error}</div>}
        {saved && (
          <div style={{
            background: '#D1FAE5', border: '1px solid #10B981',
            color: '#059669', padding: '8px 14px', borderRadius: 12,
            fontSize: 13, fontWeight: 700, marginBottom: 10, textAlign: 'center',
          }}>✅ Profile saved!</div>
        )}

        {/* ── EDIT INFO ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 10 }}>
            Edit Info
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', letterSpacing: 0.2, display: 'block', marginBottom: 6 }}>Display Name</label>
            <input className="input" style={{ padding: '11px 14px', fontSize: 14 }}
              value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', letterSpacing: 0.2, display: 'block', marginBottom: 6 }}>Mobile Number</label>
            <div style={{ display: 'flex', gap: 7 }}>
              <span style={{ padding: '10px 9px', background: '#F8F7FF', border: '1.5px solid #E8E5FF', borderRadius: 14, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>🇮🇳 +91</span>
              <input className="input" type="tel" style={{ padding: '11px 14px', fontSize: 14, flex: 1 }}
                value={phone} onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))} placeholder="9876543210" maxLength={10} />
            </div>
          </div>
        </div>

        {/* ── MY CODE ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          {myInviteCode && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 8 }}>
                My Code
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 6, color: '#000' }}>
                  {myInviteCode}
                </div>
                <button onClick={() => setShowInviteSheet(true)} style={{
                  background: '#951345', border: 'none', borderRadius: 10,
                  padding: '8px 14px', color: '#fff', fontWeight: 800,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  Invite
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── MY FAMILIES ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2 }}>
              My Families
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => navigate('/join-family')} style={{
                background: '#F5E6EC', border: '1px solid #951345', borderRadius: 8,
                padding: '5px 10px', color: '#951345', fontWeight: 700,
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Join
              </button>
              <button onClick={() => navigate('/create-family')} style={{
                background: '#951345', border: 'none', borderRadius: 8,
                padding: '5px 10px', color: '#fff', fontWeight: 700,
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Create
              </button>
            </div>
          </div>

          {/* Family list */}
          {allFamilies.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9C6B7A', textAlign: 'center', padding: '8px 0' }}>
              No families yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allFamilies.map((fam) => {
                const isActive = fam.family_id === familyId
                return (
                  <div key={fam.family_id} onClick={() => setSelectedFam(fam)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 12,
                      background: isActive ? '#FDF0F5' : '#F8F7FF',
                      border: `1.5px solid ${isActive ? '#951345' : '#E8E5FF'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: isActive ? '#951345' : '#E8E5FF',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, flexShrink: 0, overflow: 'hidden',
                        border: `2px solid ${isActive ? '#951345' : '#D4D0F5'}`,
                      }}>
                        {avatarUrl
                          ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 16 }}>{(displayName || 'U').charAt(0).toUpperCase()}</span>
                        }
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#000' }}>{fam.name}</div>
                        <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                          {fam.role === 'admin' ? '👑 Admin' : '👤 Member'}
                        </div>
                      </div>
                    </div>
                    {isActive ? (
                      <div style={{
                        background: '#951345', color: '#fff',
                        fontSize: 10, fontWeight: 800, padding: '3px 8px',
                        borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>Active</div>
                    ) : (
                      <div style={{ color: '#9C6B7A', fontSize: 12, fontWeight: 600 }}>Tap to switch →</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── PRIVACY ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 12 }}>
            Privacy
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#000' }}>🟢 Show Me Online</div>
            <Toggle on={showOnline} onToggle={handleToggleOnline} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#000' }}>📍 Show My Location</div>
            <Toggle on={showLocation} onToggle={handleToggleLocation} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#000' }}>🕐 Show Last Seen</div>
            <Toggle on={showLastSeen} onToggle={handleToggleLastSeen} />
          </div>
        </div>

        {/* ── SAVE + CHANGE PASSWORD side by side ── */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => setShowPwModal(true)} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#fff', border: '1.5px solid #951345',
            color: '#951345', fontWeight: 800, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Change Password
          </button>
        </div>

        {/* ── PRIVACY POLICY ── */}
        <div
          className="settings-card"
          onClick={() => navigate('/privacy')}
          style={{ marginTop: 10, padding: '14px 16px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔒</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>Privacy Policy</div>
                <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>How we protect your data</div>
              </div>
            </div>
            <span style={{ color: '#9C6B7A', fontSize: 18, fontWeight: 300 }}>›</span>
          </div>
        </div>

        {/* ── DELETE ACCOUNT ── */}
        <button onClick={() => setShowDeleteModal(true)} style={{
          width: '100%', marginTop: 10, padding: '14px 16px', borderRadius: 16,
          background: '#FFF0F0', border: '1.5px solid #EF4444',
          color: '#DC2626', fontWeight: 800, fontSize: 14,
          fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          Delete My Account
        </button>

      </div>
      </PullToRefresh>

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} userEmail={email} />}

      {/* ── DELETE ACCOUNT MODAL ── */}
      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            try {
              const { error } = await supabase.rpc('delete_my_account')
              if (error) throw error
              await signOut()
              window.location.href = '/login'
            } catch (err) {
              alert('Failed to delete account: ' + err.message)
            }
          }}
        />
      )}

      {/* ── INVITE SHEET ── */}
      {showInviteSheet && (
        <div className="overlay" onClick={() => setShowInviteSheet(false)}>
          <div className="popup" onClick={e => e.stopPropagation()} style={{ paddingBottom: 28 }}>
            <div className="popup-handle" />

            <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 4 }}>
              Share My Code
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 8, color: '#000', marginBottom: 4 }}>
              {myInviteCode}
            </div>
            <div style={{ fontSize: 12, color: '#9C6B7A', marginBottom: 20 }}>
              Ask your family member to enter this code on the Add Member screen
            </div>

            {/* WhatsApp */}
            <button onClick={() => {
              const msg = encodeURIComponent(`Join me on FamilyGuard! Enter my code *${myInviteCode}* when adding me as a member. Download the app and stay connected with family 🛡️`)
              window.open(`https://wa.me/?text=${msg}`, '_blank')
            }} style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: '#25D366', border: 'none',
              color: '#fff', fontWeight: 800, fontSize: 15,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.118 1.522 5.852L.057 23.25a.75.75 0 0 0 .916.916l5.404-1.464A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.65-.502-5.17-1.381l-.37-.218-3.835 1.04 1.04-3.834-.218-.371A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
              Share via WhatsApp
            </button>

            {/* SMS */}
            <button onClick={() => {
              const msg = encodeURIComponent(`Join me on FamilyGuard! My code is ${myInviteCode} — enter it when adding me as a member.`)
              window.open(`sms:?body=${msg}`, '_blank')
            }} style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: '#0EA5E9', border: 'none',
              color: '#fff', fontWeight: 800, fontSize: 15,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Share via SMS
            </button>

            {/* Copy Code */}
            <button onClick={() => {
              navigator.clipboard.writeText(myInviteCode)
              setCodeCopied(true)
              setTimeout(() => { setCodeCopied(false); setShowInviteSheet(false) }, 1200)
            }} style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: codeCopied ? '#D1FAE5' : '#F5F4FB',
              border: codeCopied ? '1.5px solid #10B981' : '1.5px solid #E9E6FB',
              color: codeCopied ? '#059669' : '#3A1020', fontWeight: 800, fontSize: 15,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={codeCopied ? '#059669' : '#951345'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {codeCopied ? '✓ Copied!' : 'Copy Code'}
            </button>

          </div>
        </div>
      )}

      {/* ── FAMILY ACTION SHEET ── */}
      {selectedFam && (
        <div className="overlay" onClick={() => setSelectedFam(null)}>
          <div className="popup" onClick={e => e.stopPropagation()} style={{ paddingBottom: 28 }}>
            <div className="popup-handle" />

            {/* Family header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: selectedFam.family_id === familyId ? '#951345' : '#E8E5FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, flexShrink: 0, overflow: 'hidden',
                border: `2px solid ${selectedFam.family_id === familyId ? '#951345' : '#D4D0F5'}`,
              }}>
                {avatarUrl
                  ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{(displayName || 'U').charAt(0).toUpperCase()}</span>
                }
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#000' }}>{selectedFam.name}</div>
                <div style={{ fontSize: 12, color: '#9C6B7A', marginTop: 2 }}>
                  {selectedFam.role === 'admin' ? '👑 Admin' : '👤 Member'}
                  {selectedFam.family_id === familyId && <span style={{ marginLeft: 8, background: '#951345', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5 }}>ACTIVE</span>}
                </div>
              </div>
            </div>

            {/* Go to Family */}
            <button onClick={() => {
              if (selectedFam.family_id !== familyId) switchFamily(selectedFam.family_id)
              setSelectedFam(null)
              navigate('/')
            }} style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: '#951345', border: 'none',
              color: '#fff', fontWeight: 800, fontSize: 15,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              View Family
            </button>

            {/* Leave Family */}
            <button onClick={async () => {
              if (!window.confirm(`Leave "${selectedFam.name}"? You will need an invite to rejoin.`)) return
              setSelectedFam(null)
              try { await leaveFamily(user.id, selectedFam.family_id) }
              catch (e) { setError(e.message) }
            }} style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: '#FFF0F0', border: '1.5px solid #EF4444',
              color: '#DC2626', fontWeight: 800, fontSize: 15,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Leave Family
            </button>

          </div>
        </div>
      )}
    </div>
  )
}
