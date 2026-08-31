import { useState, useEffect, useRef } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
const LocationService = registerPlugin('LocationService')
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import { useBackButton } from '../hooks/useBackButton'
import Dialog from '../components/Dialog'
import { ALERT_TYPES, getRingtones, pickRingtone, resetRingtone } from '../lib/ringtones'
import { useT, useLangStore, UI_LANGUAGES } from '../i18n'

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 46, height: 26, borderRadius: 13,
        background: on ? '#951345' : '#D1D5DB',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'all 0.25s', flexShrink: 0,
        boxShadow: on ? '0 2px 8px rgba(149,19,69,0.35)' : 'none',
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

// Defined at module scope, not inside ChangePasswordModal. A component declared
// during render is a new type on every render, so React unmounted and remounted
// it each time — meaning every keystroke in a password field destroyed and
// rebuilt this icon's DOM.
const EyeIcon = ({ off }) => off
  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M9.88 9.88a3 3 0 0 0 4.24 4.24" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8480B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>

// ── Change password modal ──
function ChangePasswordModal({ onClose, userEmail }) {
  const t = useT()
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

  const handleSave = async () => {
    setErr('')
    if (!oldPw) { setErr(t('profile.enterCurrentPassword')); return }
    if (pw.length < 6) { setErr(t('profile.newPasswordMin6')); return }
    if (pw !== confirm) { setErr(t('profile.newPasswordsNoMatch')); return }
    if (pw === oldPw) { setErr(t('profile.newPasswordSame')); return }
    setBusy(true)
    // Verify old password by re-signing in
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: oldPw })
    if (signInErr) { setBusy(false); setErr(t('profile.currentPasswordWrong')); return }
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
          {t('profile.changePassword')}
        </div>

        {ok ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#059669', fontWeight: 700 }}>
            ✓ {t('profile.passwordUpdated')}
          </div>
        ) : (
          <>
            {err && <div className="error-msg" style={{ marginBottom: 12 }}>{err}</div>}

            {/* Current password */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                className="input" type={show ? 'text' : 'password'} value={oldPw} autoFocus
                onChange={e => setOldPw(e.target.value)}
                placeholder={t('profile.currentPassword')}
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
                placeholder={t('profile.newPassword')}
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
                placeholder={t('profile.confirmNewPassword')}
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
              }}>{t('common.cancel')}</button>
              <button onClick={handleSave} disabled={busy} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: '#951345', border: 'none',
                color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 14,
              }}>{busy ? t('reset.verifying') : t('profile.update')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Delete account confirmation modal ──
function DeleteAccountModal({ onClose, onConfirm }) {
  const t = useT()
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
              {t('profile.deleteAccount')}
            </div>
            <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.5 }}>
              {t('profile.deleteAccountWarn')}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 6 }}>
            {t('profile.typeToConfirm', { word: CONFIRM_WORD })}
          </div>
          <input
            className="input"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value.toUpperCase())}
            placeholder={t('profile.typeDeleteHere')}
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
          }}>{t('common.cancel')}</button>
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
            {deleting ? t('profile.deleting') : t('profile.deleteForever')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const t = useT()
  const setLang = useLangStore(s => s.setLang)
  const { user, familyId, allFamilies, leaveFamily, signOut } = useAuthStore()
  const navigate = useNavigate()

  const [member, setMember]             = useState(null)
  const [myInviteCode, setMyInviteCode] = useState('')
  // null while unknown or on web, where there is no native picker; the card is
  // hidden in that case rather than offering something that cannot work.
  const [codeCopied, setCodeCopied] = useState(false)
  const [ringtones, setRingtones] = useState(null)
  // Collapsed by default: four rows of sound pickers pushed Privacy and
  // everything below it off the first screen.
  const [soundsOpen, setSoundsOpen] = useState(false)

  const [displayName, setDisplayName]   = useState('')
  const [phone, setPhone]               = useState('')
  const [email, setEmail]               = useState('')
  const [avatarUrl, setAvatarUrl]       = useState(null)
  const [showLocation, setShowLocation] = useState(true)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [showOnline, setShowOnline]     = useState(true)

  const [uploading, setUploading]       = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [error, setError]               = useState('')
  const [dialog, setDialog]             = useState(null)
  const [showPwModal, setShowPwModal]           = useState(false)
  const [showDeleteModal, setShowDeleteModal]   = useState(false)
  const [selectedFam, setSelectedFam]           = useState(null) // family action sheet
  const [viewFam, setViewFam]                   = useState(null) // { fam, members, loading } — read-only member list
  const fileRef = useRef()

  // Hardware back button closes open sheets instead of exiting the app
  useBackButton(!!selectedFam, () => setSelectedFam(null))
  useBackButton(!!viewFam, () => setViewFam(null))

  const openViewFamily = async (fam) => {
    setSelectedFam(null)
    setViewFam({ fam, members: [], loading: true })
    const { data, error: err } = await supabase
      .from('family_members')
      .select('*')
      .eq('family_id', fam.family_id)
      .order('role', { ascending: true })
    setViewFam({ fam, members: err ? [] : (data || []), loading: false })
    if (err) setError(err.message)
  }

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
      // Two registration eras, and the number lives somewhere different in
      // each. The older scheme encoded it into a synthetic address
      // (91XXXXXXXXXX@familyguard.app); accounts created through the Twilio
      // OTP flow are real phone signups, so they carry it in user.phone as
      // E.164 and have NO email at all — which is why this field came up
      // blank for them, the email regex having nothing to match against.
      // family_members.phone is null for both until someone saves it here:
      // create_family and accept_join_request only ever insert
      // (family_id, user_id, display_name, role).
      const regFromEmail = (user?.email || '').match(/^91(\d{10})@familyguard\.app$/)
      const fromAuthPhone = (user?.phone || '').replace(/^\+?91/, '')
      setPhone(
        savedPhone
        || (regFromEmail ? regFromEmail[1] : '')
        || (/^\d{10}$/.test(fromAuthPhone) ? fromAuthPhone : '')
      )
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
    if (file.size > 5 * 1024 * 1024) { setError(t('profile.photoTooBig')); return }
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
      setError(t('profile.uploadFailed', { reason: err?.message || t('profile.unknownError') }))
    } finally {
      setUploading(false)
      // reset the input so selecting the SAME file again still fires onChange
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSave = async () => {
    if (!displayName.trim()) { setError(t('profile.nameEmpty')); return }
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

  useEffect(() => { getRingtones().then(setRingtones) }, [])

  const handlePickTone = async (type) => {
    const res = await pickRingtone(type)
    // Only re-read when something actually changed — backing out of the picker
    // should leave the row exactly as it was.
    if (res?.changed) setRingtones(await getRingtones())
  }

  const handleResetTone = async (type) => {
    await resetRingtone(type)
    setRingtones(await getRingtones())
  }

  const initial = displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
  const avatarColor = member?.avatar_color || '#951345'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <div className="top-bar" style={{ alignItems: 'center' }}>
        <div
          onClick={() => { if (!uploading) fileRef.current && fileRef.current.click() }}
          title={t('profile.tapToChangePhoto')}
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
          {/* Camera edit badge */}
          <div style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 20, height: 20, borderRadius: '50%',
            background: 'linear-gradient(135deg, #951345, #720D35)',
            border: '2px solid #fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(149,19,69,0.4)',
          }}>
            {uploading
              ? <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
            }
          </div>
          <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
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
          <div className="top-bar-title" style={{ fontSize: 16 }}>{displayName || t('profile.myProfile')}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setDialog({ type: 'confirm', title: t('profile.signOut'), message: t('profile.signOutConfirm'), confirmLabel: t('profile.signOut'), onConfirm: signOut })} style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1.5px solid #fff',
            color: '#951345', borderRadius: 10,
            padding: '7px 14px', fontWeight: 800, fontSize: 12,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
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
          }}>✅ {t('profile.profileSaved')}</div>
        )}

        {/* ── LANGUAGE ──
            First card, and on Profile rather than Settings: /settings is a
            registered route but nothing in the app navigates to it, so a
            picker there could never be reached. It sits above everything else
            because someone who cannot read the rest of this screen still has
            to be able to find it — which is also why the options are written
            in their own script. */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 10 }}>
            {t('settings.language')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {UI_LANGUAGES.map(l => {
              const active = l.code === t.lang
              return (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  aria-pressed={active}
                  style={{
                    padding: '9px 16px', borderRadius: 999,
                    background: active ? 'linear-gradient(135deg,#951345,#720D35)' : '#F8F7FF',
                    border: `1.5px solid ${active ? 'transparent' : '#EDE9FF'}`,
                    color: active ? '#fff' : '#5B4652',
                    fontWeight: active ? 800 : 600,
                    fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
                    lineHeight: 1.6,
                  }}
                >
                  {l.native}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── EDIT INFO ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 10 }}>
            {t('profile.editInfo')}
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', letterSpacing: 0.2, display: 'block', marginBottom: 6, lineHeight: 1.5 }}>{t('profile.displayName')}</label>
            <input className="input" style={{ padding: '11px 14px', fontSize: 14 }}
              value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={t('profile.yourName')} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', letterSpacing: 0.2, display: 'block', marginBottom: 6, lineHeight: 1.5 }}>{t('profile.mobileNumber')}</label>
            <div style={{ display: 'flex', gap: 7 }}>
              {/* Plain "+91" — the 🇮🇳 flag emoji used to sit here, but MIUI
                  and several other Android ROMs ship no regional-indicator
                  glyphs, so the pair fell back to rendering its two underlying
                  letters as boxed capitals: the strange "IN +91". Padding and
                  font now match the input beside it so the two read as one
                  field. */}
              <span style={{
                display: 'flex', alignItems: 'center',
                padding: '11px 14px', background: '#F8F7FF',
                border: '1.5px solid #E8E5FF', borderRadius: 14,
                fontSize: 14, fontWeight: 700, color: '#5B4652',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>+91</span>
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
                {t('profile.myCode')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 3, color: '#0D0C1D', fontFamily: 'Sora, sans-serif' }}>
                  {myInviteCode}
                </div>
                <button
                  onClick={() => {
                    // Best-effort: clipboard is unavailable in some WebView
                    // configurations, and the code is on screen either way.
                    try { navigator.clipboard?.writeText(myInviteCode) } catch { /* shown above */ }
                    setCodeCopied(true)
                    setTimeout(() => setCodeCopied(false), 1400)
                  }}
                  style={{
                    background: codeCopied ? '#D1FAE5' : '#FDF0F5',
                    border: `1.5px solid ${codeCopied ? '#10B981' : '#F0D8E3'}`,
                    color: codeCopied ? '#059669' : '#951345',
                    borderRadius: 10, padding: '7px 12px',
                    fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                    cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 5,
                    transition: 'all 0.2s',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={codeCopied ? '#059669' : '#951345'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  {codeCopied ? t('profile.copied') : t('profile.copy')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── MY FAMILIES ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2 }}>
              {t('profile.myFamilies')}
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
                          {fam.role === 'admin' ? '👑 ' + t('profile.admin') : '👤 ' + t('profile.member')}
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <div style={{
                        background: '#951345', color: '#fff',
                        fontSize: 10, fontWeight: 800, padding: '3px 8px',
                        borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>{t('profile.active')}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── ALERT SOUNDS ── */}
        {/* Native only: the picker is a system Activity, so there is nothing to
            offer on web. */}
        {ringtones && (
          <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
            <button
              onClick={() => setSoundsOpen(o => !o)}
              aria-expanded={soundsOpen}
              style={{
                width: '100%', background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2 }}>
                  {t('profile.alertSounds')}
                </div>
                <div style={{ fontSize: 12.5, color: '#9C6B7A', marginTop: 3, lineHeight: 1.5 }}>
                  {t('profile.alertSoundsSub')}
                </div>
              </div>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="#C9A3B4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  flexShrink: 0,
                  transform: soundsOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.18s',
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {soundsOpen && <div style={{ height: 10 }} />}
            {soundsOpen && ALERT_TYPES.map((at, i) => (
              <div key={at.key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0',
                borderTop: i === 0 ? 'none' : '1px solid #F7EFF3',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D0C1D' }}>{t('profile.sound.' + at.key)}</div>
                  <div style={{
                    fontSize: 11.5, color: '#9C6B7A', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ringtones[at.key] || t('profile.default')}
                  </div>
                </div>
                {ringtones[at.key] && ringtones[at.key] !== t('profile.default') && (
                  <button
                    onClick={() => handleResetTone(t.key)}
                    title={`Use the default sound for ${t('profile.sound.' + at.key)}`}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#9C6B7A', fontSize: 11.5, fontWeight: 700,
                      fontFamily: 'inherit', padding: '6px 2px', flexShrink: 0,
                    }}
                  >
                    Default
                  </button>
                )}
                <button
                  onClick={() => handlePickTone(t.key)}
                  style={{
                    background: '#FDF0F5', border: '1.5px solid #F0D8E3',
                    color: '#951345', borderRadius: 10, padding: '7px 13px',
                    fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
                    cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                  }}
                >
                  Change
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── PRIVACY ── */}
        <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#951345', letterSpacing: 0.2, marginBottom: 12 }}>
            {t('profile.privacy')}
          </div>
          {[
            {
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/>
                </svg>
              ),
              label: t('profile.showMeOnline'), value: showOnline, handler: handleToggleOnline,
            },
            {
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              ),
              label: t('profile.showMyLocation'), value: showLocation, handler: handleToggleLocation,
            },
            {
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              ),
              label: t('profile.showLastSeen'), value: showLastSeen, handler: handleToggleLastSeen,
            },
          ].map((item, i, arr) => (
            <div key={item.label}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: '#FDF0F5', border: '1px solid #EDD0DA',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0D0C1D' }}>{item.label}</div>
                </div>
                <Toggle on={item.value} onToggle={item.handler} />
              </div>
              {i < arr.length - 1 && (
                <div style={{ height: 1, background: '#F5EEF2', margin: '10px 0' }} />
              )}
            </div>
          ))}
        </div>

        {/* ── SAVE + CHANGE PASSWORD side by side ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? t('common.saving') : t('profile.saveChanges')}
          </button>
          <button onClick={() => setShowPwModal(true)} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#fff', border: '1.5px solid #951345',
            color: '#951345', fontWeight: 800, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            lineHeight: 1.5, textAlign: 'center',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {t('profile.changePassword')}
          </button>
        </div>

        {/* ── USER GUIDE ── */}
        <div
          className="settings-card"
          onClick={() => navigate('/manual')}
          style={{ marginTop: 10, padding: '14px 16px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: '#F5E8EF', border: '1px solid #EDD0DA',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0D0C1D' }}>{t('profile.userGuide')}</div>
                <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>{t('profile.userGuideSub')}</div>
              </div>
            </div>
            <span style={{ color: '#9C6B7A', fontSize: 16 }}>›</span>
          </div>
        </div>

        {/* ── PRIVACY POLICY ── */}
        <div
          className="settings-card"
          onClick={() => navigate('/privacy')}
          style={{ marginTop: 10, padding: '14px 16px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: '#F5E8EF', border: '1px solid #EDD0DA',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z" fill="none"/>
                  <polyline points="9 12 11 14 15 10" fill="none"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>{t('profile.privacyPolicy')}</div>
                <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>{t('profile.privacyPolicySub')}</div>
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
          {t('profile.deleteAccount')}
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
              setDialog({ type: 'error', message: t('profile.deleteFailed') })
            }
          }}
        />
      )}

      {/* ── INVITE SHEET ── */}
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
                  {selectedFam.role === 'admin' ? '👑 ' + t('profile.admin') : '👤 ' + t('profile.member')}
                  {selectedFam.family_id === familyId && <span style={{ marginLeft: 8, background: '#951345', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5 }}>ACTIVE</span>}
                </div>
              </div>
            </div>

            {/* View Family — read-only member list, does not switch active family */}
            <button onClick={() => openViewFamily(selectedFam)} style={{
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
            <button onClick={() => {
              setDialog({
                type: 'confirm',
                title: t('profile.leaveFamily'),
                message: t('profile.leaveFamilyMsg', { name: selectedFam.name }),
                confirmLabel: t('profile.leave'),
                onConfirm: async () => {
                  setSelectedFam(null)
                  try { await leaveFamily(user.id, selectedFam.family_id) }
                  catch (e) { setError(e.message) }
                },
              })
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

      {/* ── VIEW FAMILY — read-only member list, does not touch the active family ── */}
      {viewFam && (
        <div className="overlay" onClick={() => setViewFam(null)}>
          <div className="popup" onClick={e => e.stopPropagation()} style={{ paddingBottom: 28, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <div className="popup-handle" />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#000' }}>{viewFam.fam.name}</div>
              <button onClick={() => setViewFam(null)} style={{
                background: '#F5EBF0', border: 'none', borderRadius: 10,
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {viewFam.loading ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#9C6B7A', fontSize: 13 }}>{t('profile.loadingMembers')}</div>
              ) : viewFam.members.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#9C6B7A', fontSize: 13 }}>{t('profile.noMembersFound')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viewFam.members.map((m) => (
                    <div key={m.user_id || m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 12,
                      background: '#F8F7FF', border: '1.5px solid #E8E5FF',
                    }}>
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt={m.display_name} style={{
                          width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                        }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                          background: m.avatar_color && m.avatar_color !== '#4F8EF7' ? m.avatar_color : '#951345',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 800, fontSize: 16,
                        }}>
                          {m.display_name?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.display_name || t('profile.unknown')}
                        </div>
                        <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                          {m.role === 'admin' ? '👑 ' + t('profile.admin') : '👤 ' + t('profile.member')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <Dialog
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
