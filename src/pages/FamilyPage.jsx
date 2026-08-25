import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import MemberPopup from '../components/MemberPopup'
import PullToRefresh from '../components/PullToRefresh'
import { useBackButton } from '../hooks/useBackButton'

const AVATAR_COLORS = ['#951345','#720D35','#C0185A','#F59E0B','#10B981','#0EA5E9','#F43F5E']

function formatLastSeen(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 30) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function isOnline(ts) {
  if (!ts) return false
  return (Date.now() - new Date(ts)) < 2 * 60 * 1000
}

// Haversine distance in km between two lat/lng points
function distanceKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null
  const R = 6371 // earth radius km
  const toRad = (d) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function formatDistance(km) {
  if (km == null) return null
  if (km < 0.1) return 'Nearby'
  if (km < 1) return `${Math.round(km * 1000)} m away`
  if (km < 10) return `${km.toFixed(1)} km away`
  return `${Math.round(km)} km away`
}

function SOSAlert({ alert, memberName, onDismiss }) {
  return (
    <div className="sos-blink-overlay" onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon">🆘</div>
        <div className="sos-alert-title">{memberName || 'A family member'} Is In Trouble!</div>
        <div className="sos-alert-sub">
          {alert.message || 'SOS Alert'}
          {alert.lat !== 0 && (
            <><br />
              <a href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>
                📍 View Location
              </a>
            </>
          )}
        </div>
        <button className="sos-alert-dismiss" onClick={onDismiss}>✋ I Understand — Dismiss</button>
      </div>
    </div>
  )
}

// ── Long-press action sheet: Edit Name + Remove ──
function MemberActionSheet({ member, displayName, isOwner, onClose, onEditName, onRemove, onFindDevice }) {
  const shown = displayName || member.display_name
  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />

        {/* Member info header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #F0E4EA' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
            background: member.avatar_color || '#951345',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: 'Sora, sans-serif',
          }}>
            {shown?.[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#000' }}>{shown}</div>
            <div style={{ fontSize: 12, color: '#9C6B7A', marginTop: 3 }}>{member.phone || 'No phone saved'}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={onEditName} style={{
            width: '100%', padding: '14px 18px', borderRadius: 14,
            background: '#F5E6EC', border: '1px solid #951345',
            color: '#951345', fontWeight: 700, fontSize: 15,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            ✏️ Set Nickname
          </button>

          <button onClick={onFindDevice} style={{
            width: '100%', padding: '14px 18px', borderRadius: 14,
            background: '#EFF6FF', border: '1px solid #3B82F6',
            color: '#3B82F6', fontWeight: 700, fontSize: 15,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            📡 Find My Device
          </button>

          {isOwner && (
            <button onClick={onRemove} style={{
              width: '100%', padding: '14px 18px', borderRadius: 14,
              background: '#FFF0F3', border: '1px solid #E11D48',
              color: '#E11D48', fontWeight: 700, fontSize: 15,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              🗑 Remove from Family
            </button>
          )}

          <button onClick={onClose} style={{
            width: '100%', padding: '13px 18px', borderRadius: 14,
            background: '#F5F4FB', border: '1px solid #E9E6FB',
            color: '#3A1020', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit name modal ──
function EditNameModal({ member, currentNickname, onClose, onSave }) {
  const [name, setName] = useState(currentNickname || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    // Empty is allowed — it clears the nickname and reverts to the real name.
    setSaving(true)
    await onSave(member, name.trim())
    setSaving(false)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />
        <div style={{ fontSize: 11, fontWeight: 800, color: '#951345', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Set Nickname · {member.display_name}
        </div>
        <div style={{ fontSize: 12, color: '#8480B0', marginBottom: 14, lineHeight: 1.4 }}>
          This nickname is private — only you see it. {member.display_name} and everyone else still see their own name.
        </div>
        <input
          className="input" value={name} autoFocus
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder={`e.g. a nickname for ${member.display_name}`}
          style={{ marginBottom: 8 }}
        />
        <div style={{ fontSize: 11, color: '#B0AAC8', marginBottom: 16 }}>
          Leave blank and save to remove the nickname.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#F5F4FB', border: '1px solid #E9E6FB',
            color: '#3A1020', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: '#951345', border: 'none',
            color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
          }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

export default function FamilyPage() {
  const { user, familyId, familyName, inviteCode, updateFamilyName } = useAuthStore()
  const [members, setMembers]           = useState([])
  const [membersLoaded, setMembersLoaded] = useState(false)   // false until first fetch returns
  const [nicknames, setNicknames]       = useState({})        // { [target_user_id]: nickname } — private to me
  const [locations, setLocations]       = useState({})
  const [joinRequests, setJoinRequests] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)   // tap → MemberPopup
  const [actionMember, setActionMember]     = useState(null)   // long-press → action sheet
  const [editNameMember, setEditNameMember] = useState(null)   // → edit modal
  const [editingFamilyName, setEditingFamilyName] = useState(false)
  const [newFamilyName, setNewFamilyName]           = useState('')
  const [sosAlert, setSosAlert]         = useState(null)
  const [sosAlertMember, setSosAlertMember] = useState(null)
  const [isOwner, setIsOwner]           = useState(false)      // is current user the family creator?
  const longPressTimer = useRef(null)
  const didLongPress = useRef(false)
  const navigate = useNavigate()

  // Hardware back closes open sheets/modals instead of exiting the app.
  // (MemberPopup handles its own back for selectedMember.)
  useBackButton(!!actionMember, () => setActionMember(null))
  useBackButton(!!editNameMember, () => setEditNameMember(null))
  useBackButton(editingFamilyName, () => setEditingFamilyName(false))

  // My own location (used as the reference point for distance calc)
  const myLoc = user ? locations[user.id] : null
  const myHasCoords = myLoc && myLoc.lat && myLoc.lng && !(myLoc.lat === 0 && myLoc.lng === 0)

  // Name to show for a member: MY private nickname if I set one, else their real name.
  // Nicknames are private — they never change what other people see.
  const nameFor = (m) => nicknames[m.user_id] || m.display_name

  // Reusable data loader — used on mount AND by pull-to-refresh.
  const loadData = async () => {
    if (!familyId || !user) return

    const [famRes, memRes, nickRes, locRes, reqRes] = await Promise.all([
      supabase.from('families').select('created_by').eq('id', familyId).single(),
      supabase.from('family_members').select('*').eq('family_id', familyId),
      supabase.from('member_nicknames').select('target_user_id, nickname')
        .eq('family_id', familyId).eq('owner_user_id', user.id),
      supabase.from('locations').select('user_id, lat, lng, updated_at, is_sharing')
        .eq('family_id', familyId),
      supabase.from('join_requests').select('*')
        .eq('family_id', familyId).eq('status', 'pending'),
    ])

    if (famRes.data) setIsOwner(famRes.data.created_by === user.id)
    if (memRes.data) setMembers(memRes.data)
    setMembersLoaded(true)
    if (nickRes.data) {
      const map = {}
      nickRes.data.forEach(n => { map[n.target_user_id] = n.nickname })
      setNicknames(map)
    }
    if (locRes.data) {
      const map = {}
      locRes.data.forEach(l => { map[l.user_id] = { lat: l.lat, lng: l.lng, updatedAt: l.updated_at, isSharing: l.is_sharing } })
      setLocations(map)
    }
    if (reqRes.data) setJoinRequests(reqRes.data)
  }

  useEffect(() => {
    if (!familyId || !user) return

    // Check if this user is the owner of this family
    supabase.from('families').select('created_by').eq('id', familyId).single()
      .then(({ data }) => { if (data) setIsOwner(data.created_by === user.id) })

    supabase.from('family_members').select('*').eq('family_id', familyId)
      .then(({ data }) => { if (data) setMembers(data); setMembersLoaded(true) })

    // My own private nicknames for this family (only I can read these via RLS)
    supabase.from('member_nicknames')
      .select('target_user_id, nickname')
      .eq('family_id', familyId).eq('owner_user_id', user.id)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(n => { map[n.target_user_id] = n.nickname })
          setNicknames(map)
        }
      })

    supabase.from('locations').select('user_id, lat, lng, updated_at, is_sharing')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(l => { map[l.user_id] = { lat: l.lat, lng: l.lng, updatedAt: l.updated_at, isSharing: l.is_sharing } })
          setLocations(map)
        }
      })

    supabase.from('join_requests').select('*')
      .eq('family_id', familyId).eq('status', 'pending')
      .then(({ data }) => { if (data) setJoinRequests(data) })

    const channel = supabase
      .channel(`family-page:${familyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `family_id=eq.${familyId}` },
        (payload) => { setJoinRequests(prev => [payload.new, ...prev]) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `family_id=eq.${familyId}` },
        (payload) => {
          setJoinRequests(prev => prev.filter(r => r.id !== payload.new.id))
          if (payload.new.status === 'accepted') {
            supabase.from('family_members').select('*').eq('family_id', familyId)
              .then(({ data }) => { if (data) setMembers(data) })
          }
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.new) {
            setLocations(prev => ({ ...prev, [payload.new.user_id]: { lat: payload.new.lat, lng: payload.new.lng, updatedAt: payload.new.updated_at, isSharing: payload.new.is_sharing } }))
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'family_members', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.new) {
            setMembers(prev => prev.map(m =>
              m.user_id === payload.new.user_id
                ? { ...m, last_active: payload.new.last_active, avatar_url: payload.new.avatar_url || m.avatar_url, display_name: payload.new.display_name }
                : m
            ))
          }
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: `family_id=eq.${familyId}` },
        (payload) => { if (payload.new && payload.new.user_id !== user?.id) setSosAlert(payload.new) })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId, user])

  useEffect(() => {
    if (!sosAlert) { setSosAlertMember(null); return }
    const m = members.find(m => m.user_id === sosAlert.user_id)
    setSosAlertMember(m?.display_name || 'A family member')
  }, [sosAlert, members])

  // SECURE: RPC validates admin role server-side; user_id comes from auth.uid()
  const handleAccept = async (request) => {
    try {
      const { error } = await supabase.rpc('accept_join_request', { request_id: request.id })
      if (error) throw error
      alert(`✅ ${request.requester_name} added to family!`)
    } catch (err) { alert('Error: ' + err.message) }
  }

  const handleReject = async (request) => {
    try {
      const { error } = await supabase.rpc('reject_join_request', { request_id: request.id })
      if (error) throw error
    } catch (err) { alert('Error: ' + err.message) }
  }

  const handleSaveFamilyName = async () => {
    if (!newFamilyName.trim()) return
    try { await updateFamilyName(familyId, newFamilyName.trim()); setEditingFamilyName(false) }
    catch (err) {
      setEditingFamilyName(false)
      const msg = err.message || ''
      if (msg.includes('PGRST301') || msg.includes('permission') || msg.includes('not authorized')) {
        alert('Only the family creator can rename this family.')
      } else {
        alert('Could not rename family: ' + msg)
      }
    }
  }

  // Long press → action sheet
  const startLongPress = useCallback((member) => {
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      // Haptic feedback — short vibration on Android WebView
      try { if (navigator.vibrate) navigator.vibrate(40) } catch (e) {}
      setActionMember(member)
    }, 600)
  }, [])
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }, [])

  const handleFindDevice = async (member) => {
    setActionMember(null)
    // SECURE: send_device_ping RPC forces sent_by = auth.uid() server-side
    const { error: pingErr } = await supabase.rpc('send_device_ping', {
      p_family_id:      familyId,
      p_target_user_id: member.user_id,
    })
    if (pingErr) { alert('Error: ' + pingErr.message); return }
    alert(`📡 Ping sent to ${member.display_name}'s device!`)
  }

  const handleSaveMemberName = async (member, newName) => {
    const trimmed = (newName || '').trim()
    // Store a PRIVATE nickname — this only changes what I see, never the
    // member's real display_name that everyone else sees.
    const { error } = await supabase.rpc('set_member_nickname', {
      p_family_id:      familyId,
      p_target_user_id: member.user_id,
      p_nickname:       trimmed,
    })
    if (error) { alert('Failed to save name: ' + error.message); return }

    setNicknames(prev => {
      const next = { ...prev }
      if (trimmed) next[member.user_id] = trimmed
      else delete next[member.user_id]   // blank clears the nickname
      return next
    })
  }

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Remove "${member.display_name}" from the family?`)) return
    // SECURE: remove_family_member RPC validates admin role server-side
    const { error } = await supabase.rpc('remove_family_member', {
      p_family_id: familyId,
      p_user_id:   member.user_id,
    })
    if (error) { alert('Error: ' + error.message); return }
    setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
    setActionMember(null)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {sosAlert && <SOSAlert alert={sosAlert} memberName={sosAlertMember} onDismiss={() => setSosAlert(null)} />}

      {/* Long-press action sheet */}
      {actionMember && (
        <MemberActionSheet
          member={actionMember}
          displayName={nameFor(actionMember)}
          isOwner={isOwner && actionMember.user_id !== user?.id}
          onClose={() => setActionMember(null)}
          onEditName={() => { setEditNameMember(actionMember); setActionMember(null) }}
          onRemove={() => handleRemoveMember(actionMember)}
          onFindDevice={() => handleFindDevice(actionMember)}
        />
      )}

      {/* Edit name modal */}
      {editNameMember && (
        <EditNameModal
          member={editNameMember}
          currentNickname={nicknames[editNameMember.user_id] || ''}
          onClose={() => setEditNameMember(null)}
          onSave={handleSaveMemberName}
        />
      )}

      {/* Top Bar */}
      <div className="top-bar">
        <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
          {editingFamilyName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" value={newFamilyName}
                onChange={e => setNewFamilyName(e.target.value)}
                style={{ padding: '6px 12px', fontSize: 15, flex: 1 }}
                autoFocus onKeyDown={e => e.key === 'Enter' && handleSaveFamilyName()} />
              <button onClick={handleSaveFamilyName} style={{
                background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              }}>Save</button>
              <button onClick={() => setEditingFamilyName(false)} style={{
                background: 'none', border: 'none', borderRadius: 8,
                padding: '6px 10px', cursor: 'pointer', fontSize: 16, color: 'rgba(255,255,255,0.7)',
              }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="top-bar-title">{familyName}</div>
                  {isOwner && (
                    <button onClick={() => { setNewFamilyName(familyName); setEditingFamilyName(true) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.45)', padding: 0 }}>✏️</button>
                  )}
                </div>
                {inviteCode && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1, letterSpacing: 2, fontWeight: 700 }}>
                    Family Code: {inviteCode}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <PullToRefresh onRefresh={loadData}>
      <div className="page-content-inner" style={{ padding: '18px 16px' }}>

        {/* Join Requests */}
        {joinRequests.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ color: 'var(--rose)' }}>
              🔔 Join Requests ({joinRequests.length})
            </div>
            {joinRequests.map(req => (
              <div key={req.id} style={{
                background: '#FFFBEB', borderRadius: 18, padding: 16, marginBottom: 10,
                border: '1.5px solid rgba(245,158,11,0.3)',
                boxShadow: '0 4px 16px rgba(245,158,11,0.12)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%', background: '#D97706',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 18,
                  }}>
                    {req.requester_name[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#000' }}>{req.requester_name}</div>
                    <div style={{ fontSize: 12, color: '#9C6B7A', marginTop: 2 }}>
                      Wants to join · {new Date(req.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleAccept(req)} style={{
                    flex: 1, padding: 11, borderRadius: 12, background: '#059669',
                    color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>✅ Accept</button>
                  <button onClick={() => handleReject(req)} style={{
                    flex: 1, padding: 11, borderRadius: 12, background: '#fff',
                    color: '#E11D48', border: '1.5px solid rgba(225,29,72,0.3)',
                    fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>❌ Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Members list */}
        <div className="section-title">
          Family Members ({members.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            · Hold to edit or remove
          </span>
        </div>

        {!membersLoaded ? (
          // Skeleton loaders while data is fetching
          [1,2,3].map(i => (
            <div key={i} className="skeleton-card">
              <div className="skeleton skeleton-avatar" />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton-line" style={{ width: '55%' }} />
                <div className="skeleton skeleton-line" style={{ width: '35%', marginBottom: 0 }} />
              </div>
              <div className="skeleton" style={{ width: 28, height: 44, borderRadius: 8 }} />
            </div>
          ))
        ) : members.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                <circle cx="7" cy="7.5" r="3" fill="#951345" />
                <path d="M2 19c0-3 2.2-5 5-5s5 2 5 5" fill="#C0185A" />
                <circle cx="17" cy="7.5" r="3" fill="#F59E0B" />
                <path d="M12 19c0-3 2.2-5 5-5s5 2 5 5" fill="#0EA5E9" />
              </svg>
            </div>
            <div className="empty-text">No members yet</div>
            <div className="empty-sub">Share your family code to add members</div>
          </div>
        ) : (
          members.map((m, i) => {
            const loc = locations[m.user_id]
            const activeTs = m.last_active || loc?.updatedAt || null
            const online = isOnline(activeTs) && m.show_online !== false
            const lastSeen = formatLastSeen(activeTs)
            return (
              <div
                key={m.id}
                className="member-card"
                onClick={() => { if (didLongPress.current) { didLongPress.current = false; return }; setSelectedMember(m) }}
                onMouseDown={() => startLongPress(m)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(m)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={nameFor(m)} style={{
                      width: 50, height: 50, borderRadius: '50%', objectFit: 'cover',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    }} />
                  ) : (
                    <div className="avatar" style={{ background: m.avatar_color || AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {nameFor(m)?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div style={{
                    position: 'absolute', bottom: 1, right: 1,
                    width: 13, height: 13, borderRadius: '50%',
                    background: online ? '#10B981' : '#D1D5DB',
                    border: '2.5px solid #fff',
                    boxShadow: online ? '0 0 0 2px rgba(16,185,129,0.25), 0 0 8px rgba(16,185,129,0.5)' : 'none',
                    transition: 'all 0.3s',
                  }} />
                </div>
                <div className="member-info">
                  <div className="member-name" style={{ color: '#0D0C1D' }}>{nameFor(m)}</div>
                  <div className="member-meta" style={{ color: '#8480B0' }}>
                    {online ? (
                      <span style={{ color: '#10B981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                        Online
                      </span>
                    ) : lastSeen ? (
                      <span>Last seen {lastSeen}</span>
                    ) : (
                      <span>Not yet active</span>
                    )}
                  </div>
                </div>

                {/* Location sharing indicator — right side */}
                <div style={{
                  marginLeft: 'auto', flexShrink: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4,
                }}>
                  {/* Battery */}
                  {loc?.battery !== null && loc?.battery !== undefined && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      background: loc.battery <= 20 ? '#FEF2F2' : loc.isCharging ? '#F0FDF4' : '#F8F7FF',
                      borderRadius: 6, padding: '2px 6px',
                      border: `1px solid ${loc.battery <= 20 ? '#FCA5A5' : loc.isCharging ? '#BBF7D0' : '#EDE9FF'}`,
                    }}>
                      <span style={{ fontSize: 10 }}>{loc.isCharging ? '⚡' : loc.battery <= 20 ? '🪫' : '🔋'}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: loc.battery <= 20 ? '#DC2626' : loc.isCharging ? '#16A34A' : '#6B7280' }}>
                        {loc.battery}%
                      </span>
                    </div>
                  )}
                  {/* Driving */}
                  {loc?.speed > 15 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      background: '#EFF6FF', borderRadius: 6, padding: '2px 6px',
                      border: '1px solid #BFDBFE',
                    }}>
                      <span style={{ fontSize: 10 }}>🚗</span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: '#1D4ED8' }}>{Math.round(loc.speed)}km/h</span>
                    </div>
                  )}
                  <div style={{ position: 'relative', width: 28, height: 28 }}>
                    {/* Map pin SVG */}
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                        fill={loc?.isSharing ? '#10B981' : '#D1D5DB'} />
                      <circle cx="12" cy="9" r="2.5" fill="#fff" />
                    </svg>
                    {/* Strike-through X overlay when not sharing */}
                    {!loc?.isSharing && (
                      <svg width="28" height="28" viewBox="0 0 24 24"
                        style={{ position: 'absolute', top: 0, left: 0 }}>
                        <line x1="4" y1="4" x2="20" y2="20"
                          stroke="#E11D48" strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="20" y1="4" x2="4" y2="20"
                          stroke="#E11D48" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.2,
                    color: loc?.isSharing ? '#10B981' : '#E11D48',
                  }}>
                    {loc?.isSharing ? 'Live' : 'Off'}
                  </span>
                  {(() => {
                    // Show distance from me to this member (not for myself)
                    if (m.user_id === user?.id) return null
                    if (!myHasCoords || !loc?.isSharing) return null
                    if (!loc.lat || !loc.lng || (loc.lat === 0 && loc.lng === 0)) return null
                    const km = distanceKm(myLoc.lat, myLoc.lng, loc.lat, loc.lng)
                    const label = formatDistance(km)
                    if (!label) return null
                    return (
                      <span style={{
                        fontSize: 9, fontWeight: 600, color: '#6B7280',
                        marginTop: 1, whiteSpace: 'nowrap',
                      }}>
                        {label}
                      </span>
                    )
                  })()}
                </div>

              </div>
            )
          })
        )}
      </div>
      </PullToRefresh>

      {selectedMember && (
        <MemberPopup
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  )
}
