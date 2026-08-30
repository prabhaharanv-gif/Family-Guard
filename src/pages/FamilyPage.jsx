import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import MemberPopup from '../components/MemberPopup'
import Dialog from '../components/Dialog'
import FamilyIllustration from '../components/FamilyIllustration'
import PullToRefresh from '../components/PullToRefresh'
import { useBackButton } from '../hooks/useBackButton'

const AVATAR_COLORS = ['#951345','#720D35','#C0185A','#A01040','#B01650','#8A0F3A','#6B0B2C']

function formatLastSeen(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 30) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Presence needs BOTH the explicit flag and a fresh heartbeat.
//
// is_online alone would strand a member Online forever if their process was
// killed hard enough never to send the offline signal (force-stop, battery
// killer, crash). A fresh last_active alone is what caused the original bug —
// background location pushes kept refreshing it with the app closed.
//
// The window is 75s against a 30s heartbeat: two beats may be missed to a
// flaky connection before a genuinely-present member is shown offline.
const ONLINE_STALE_MS = 75 * 1000

function isOnline(member) {
  if (!member || member.is_online !== true) return false
  if (!member.last_active) return false
  return (Date.now() - new Date(member.last_active)) < ONLINE_STALE_MS
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
// ── Action sheet icons ──────────────────────────────────────────────────────
// Inline SVG rather than emoji: emoji are font glyphs, so they render
// differently on every device, sit off the text baseline, and cannot take the
// maroon theme. Same reason the call controls were converted.
const sheetIcon = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}
const PencilIcon = () => (
  <svg width="18" height="18" {...sheetIcon}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const RadarIcon = () => (
  <svg width="18" height="18" {...sheetIcon}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
    <path d="M4.9 19.1a10 10 0 0 1 0-14.2" />
    <path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
  </svg>
)
const TrashIcon = () => (
  <svg width="18" height="18" {...sheetIcon}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14h10l1-14" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

/**
 * One action row: tinted icon tile, label, one-line explanation, chevron.
 *
 * Rows share a neutral background and carry colour only in the icon tile, so
 * the destructive action can be set apart by tone instead of every action
 * competing as a full-width coloured block.
 */
function ActionRow({ icon, label, sub, color, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 6px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        background: `${color}14`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: danger ? color : '#0D0C1D' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: '#9C6B7A', marginTop: 1.5, lineHeight: 1.45 }}>{sub}</div>
      </div>
      <span style={{ color: '#D8C3CD', fontSize: 17, flexShrink: 0 }}>›</span>
    </button>
  )
}

function MemberActionSheet({ member, displayName, isOwner, onClose, onEditName, onRemove, onFindDevice }) {
  const shown = displayName || member.display_name
  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />

        {/* Member info header. Uses the real profile photo — the sheet used to
            draw an initials circle while the list behind it showed the actual
            photo, which read as two different people. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, paddingBottom: 16, borderBottom: '1px solid #F0E4EA' }}>
          {member.avatar_url ? (
            <img
              src={member.avatar_url}
              alt={shown}
              style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #951345' }}
            />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
              background: member.avatar_color && member.avatar_color !== '#4F8EF7' ? member.avatar_color : '#951345',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: 'Sora, sans-serif',
            }}>
              {shown?.[0]?.toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#0D0C1D' }}>{shown}</div>
            <div style={{ fontSize: 12, color: '#9C6B7A', marginTop: 3 }}>{member.phone || 'No phone saved'}</div>
          </div>
        </div>

        {/* Everyday actions */}
        <ActionRow
          icon={<PencilIcon />} color="#951345"
          label="Set Nickname" sub="A private name only you see"
          onClick={onEditName}
        />
        <div style={{ height: 1, background: '#F7EFF3' }} />
        <ActionRow
          icon={<RadarIcon />} color="#951345"
          label="Find My Device" sub="Ring their phone, even on silent"
          onClick={onFindDevice}
        />

        {/* Destructive action, deliberately separated and quieter than the
            everyday ones — it is irreversible and rarely what you came for. */}
        {isOwner && (
          <>
            <div style={{ height: 1, background: '#F0E4EA', margin: '8px 0' }} />
            <ActionRow
              icon={<TrashIcon />} color="#E11D48" danger
              label="Remove from Family" sub="They lose access to this family"
              onClick={onRemove}
            />
          </>
        )}

        <button onClick={onClose} style={{
          width: '100%', padding: '13px 18px', borderRadius: 14, marginTop: 14,
          background: '#F7F4F8', border: '1px solid #EEE6EC',
          color: '#5B4652', fontWeight: 700, fontSize: 14,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Cancel
        </button>
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
          Clear the field and save to remove the nickname.
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
  const { user, familyId, familyName, inviteCode, updateFamilyName, allFamilies, switchFamily } = useAuthStore()
  const [members, setMembers]           = useState([])
  const [membersLoaded, setMembersLoaded] = useState(false)   // false until first fetch returns
  const [nicknames, setNicknames]       = useState({})        // { [target_user_id]: nickname } — private to me
  const [locations, setLocations]       = useState({})
  const [joinRequests, setJoinRequests] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)   // tap → MemberPopup
  const [actionMember, setActionMember]     = useState(null)   // long-press → action sheet
  const [editNameMember, setEditNameMember] = useState(null)   // → edit modal
  const [editingFamilyName, setEditingFamilyName] = useState(false)
  const [showFamilySwitcher, setShowFamilySwitcher] = useState(false)
  const [showInviteSheet, setShowInviteSheet]       = useState(false)
  const [codeCopied, setCodeCopied]                 = useState(false)
  const [newFamilyName, setNewFamilyName]           = useState('')
  const [sosAlert, setSosAlert]         = useState(null)
  const [sosAlertMember, setSosAlertMember] = useState(null)
  const [isOwner, setIsOwner]           = useState(false)      // is current user the family creator?
  const [dialog, setDialog]             = useState(null)
  const longPressTimer = useRef(null)
  const didLongPress = useRef(false)
  const navigate = useNavigate()

  // Presence and "last seen" are derived from timestamps, so they go stale with
  // no incoming event to re-render them. A member whose process was force-stopped
  // sends no offline signal and no further heartbeats — without this tick they
  // would sit on screen as Online indefinitely. 15s keeps the 75s staleness
  // window accurate to within a fifth of itself.
  const [, setPresenceTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setPresenceTick(n => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  // Hardware back closes open sheets/modals instead of exiting the app.
  // (MemberPopup handles its own back for selectedMember.)
  useBackButton(!!actionMember, () => setActionMember(null))
  useBackButton(!!editNameMember, () => setEditNameMember(null))
  useBackButton(editingFamilyName, () => setEditingFamilyName(false))
  useBackButton(showInviteSheet, () => setShowInviteSheet(false))

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
      supabase.from('locations').select('user_id, lat, lng, updated_at, is_sharing, location_enabled, battery_level, is_charging')
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
      locRes.data.forEach(l => { map[l.user_id] = { lat: l.lat, lng: l.lng, updatedAt: l.updated_at, isSharing: l.is_sharing, locEnabled: l.location_enabled !== false, battery: l.battery_level ?? null, isCharging: l.is_charging ?? false } })
      setLocations(map)
    }
    if (reqRes.data) setJoinRequests(reqRes.data)
  }

  useEffect(() => {
    if (!familyId || !user) return

    // Single parallel load — replaces the 5 individual queries that ran on mount
    loadData()

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
            setLocations(prev => ({ ...prev, [payload.new.user_id]: {
              lat: payload.new.lat, lng: payload.new.lng,
              updatedAt: payload.new.updated_at,
              isSharing: payload.new.is_sharing,
              locEnabled: payload.new.location_enabled !== false,
              // An UPDATE payload can omit columns that did not change, so fall
              // back to what we already had rather than blanking the indicator.
              battery: payload.new.battery_level ?? prev[payload.new.user_id]?.battery ?? null,
              isCharging: payload.new.is_charging ?? prev[payload.new.user_id]?.isCharging ?? false,
            } }))
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'family_members', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.new) {
            setMembers(prev => prev.map(m =>
              m.user_id === payload.new.user_id
                ? { ...m, last_active: payload.new.last_active, is_online: payload.new.is_online, avatar_url: payload.new.avatar_url || m.avatar_url, display_name: payload.new.display_name }
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
      setDialog({ type: 'alert', title: 'Member Added', message: `${request.requester_name} has been added to the family!` })
    } catch (err) { setDialog({ type: 'error', message: err.message }) }
  }

  const handleReject = async (request) => {
    try {
      const { error } = await supabase.rpc('reject_join_request', { request_id: request.id })
      if (error) throw error
    } catch (err) { setDialog({ type: 'error', message: err.message }) }
  }

  const handleSaveFamilyName = async () => {
    if (!newFamilyName.trim()) return
    try { await updateFamilyName(familyId, newFamilyName.trim()); setEditingFamilyName(false) }
    catch (err) {
      setEditingFamilyName(false)
      const msg = err.message || ''
      if (msg.includes('PGRST301') || msg.includes('permission') || msg.includes('not authorized')) {
        setDialog({ type: 'error', title: 'Admin Only', message: 'Only the family creator can rename the family.' })
      } else {
        setDialog({ type: 'error', message: 'Could not rename family. Please try again.' })
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

  const handleStartCall = async (member, callType) => {
    setActionMember(null)
    setSelectedMember(null)
    const { data, error } = await supabase.rpc('create_call', {
      p_family_id:  familyId,
      p_callee_id:  member.user_id,
      p_call_type:  callType,
    })
    if (error) { setDialog({ type: 'error', message: error.message }); return }
    navigate(`/call/${data.id}`)
  }

  const handleFindDevice = async (member) => {
    setActionMember(null)
    // SECURE: send_device_ping RPC forces sent_by = auth.uid() server-side
    const { error: pingErr } = await supabase.rpc('send_device_ping', {
      p_family_id:      familyId,
      p_target_user_id: member.user_id,
    })
    if (pingErr) { setDialog({ type: 'error', message: pingErr.message }); return }
    setDialog({ type: 'alert', title: 'Ping Sent', message: `${member.display_name}'s phone will ring for 30 seconds, even if it's on silent.` })
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
    if (error) { setDialog({ type: 'error', message: 'Failed to save name. Please try again.' }); return }

    setNicknames(prev => {
      const next = { ...prev }
      if (trimmed) next[member.user_id] = trimmed
      else delete next[member.user_id]   // blank clears the nickname
      return next
    })
  }

  const handleRemoveMember = (member) => {
    setDialog({
      type: 'confirm',
      title: 'Remove Member',
      message: `Remove "${member.display_name}" from the family? They will need a new invite to rejoin.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        // SECURE: remove_family_member RPC validates admin role server-side
        const { error } = await supabase.rpc('remove_family_member', {
          p_family_id: familyId,
          p_user_id:   member.user_id,
        })
        if (error) { setDialog({ type: 'error', message: error.message }); return }
        setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
        setActionMember(null)
      },
    })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {sosAlert && <SOSAlert alert={sosAlert} memberName={sosAlertMember} onDismiss={() => setSosAlert(null)} />}

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

      {/* Long-press action sheet */}
      {/* ── Invite Sheet ── */}
      {/* Shares THIS family's invite code. Whoever enters it on the Join Family
          screen creates a join_request an admin here must accept, so the code
          alone never grants access. */}
      {showInviteSheet && (
        <div className="overlay" onClick={() => setShowInviteSheet(false)}>
          {/* .popup ships 6px/22px/44px padding and .popup-handle another
              14+24px of margin — about 66px of fixed chrome that dwarfed this
              sheet's four short rows. Overridden here only; the other sheets
              have far more content and still want the room. */}
          <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '4px 20px 14px' }}>
            <div className="popup-handle" style={{ margin: '9px auto 13px' }} />

            <div style={{
              fontSize: 10.5, fontWeight: 700, color: '#951345',
              letterSpacing: 0.2, marginBottom: 8,
            }}>
              Invite to {familyName}
            </div>

            {/* Plain maroon outline, no fill — the code is the only thing in
                the box, so the border just frames it rather than decorating. */}
            <div style={{
              background: 'transparent',
              border: '2px solid #951345',
              borderRadius: 16,
              padding: '9px 12px',
              marginBottom: 9,
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: 22, fontWeight: 900, letterSpacing: 4,
                color: '#951345', fontFamily: 'Sora, sans-serif', lineHeight: 1.15,
              }}>
                {inviteCode}
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#9C6B7A', marginBottom: 12, lineHeight: 1.4 }}>
              They enter this on the Join Family screen — you approve first.
            </div>

            {/* WhatsApp */}
            <button onClick={() => {
              const msg = encodeURIComponent(`Join our family on Famora! Enter the code *${inviteCode}* on the Join Family screen and I'll approve you. 🛡️`)
              window.open(`https://wa.me/?text=${msg}`, '_blank')
            }} style={{
              width: '100%', padding: '11px 14px', borderRadius: 13,
              background: '#25D366', border: 'none',
              color: '#fff', fontWeight: 800, fontSize: 13.5,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              marginBottom: 8,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.118 1.522 5.852L.057 23.25a.75.75 0 0 0 .916.916l5.404-1.464A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.65-.502-5.17-1.381l-.37-.218-3.835 1.04 1.04-3.834-.218-.371A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
              Share via WhatsApp
            </button>

            {/* Copy */}
            <button onClick={() => {
              // Best-effort: clipboard is unavailable in some WebView configs,
              // and the code is on screen anyway, so failing is not worth an error.
              try { navigator.clipboard?.writeText(inviteCode) } catch { /* shown above */ }
              setCodeCopied(true)
              setTimeout(() => { setCodeCopied(false); setShowInviteSheet(false) }, 1200)
            }} style={{
              width: '100%', padding: '10px 14px', borderRadius: 13,
              background: codeCopied ? '#D1FAE5' : '#F7F4F8',
              border: codeCopied ? '1.5px solid #10B981' : '1.5px solid #EDE7EF',
              color: codeCopied ? '#059669' : '#3A1020', fontWeight: 800, fontSize: 13.5,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              transition: 'all 0.2s',
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={codeCopied ? '#059669' : '#951345'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {codeCopied ? 'Copied!' : 'Copy Code'}
            </button>

          </div>
        </div>
      )}

      {/* ── Family Switcher Sheet ── */}
      {showFamilySwitcher && (
        <div className="overlay" onClick={() => setShowFamilySwitcher(false)}>
          <div className="popup" onClick={e => e.stopPropagation()}>
            <div className="popup-handle" />
            <div style={{ fontSize: 11, fontWeight: 800, color: '#951345', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Switch Family
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
              {allFamilies.map(fam => {
                const isActive = fam.family_id === familyId
                return (
                  <button key={fam.family_id}
                    onClick={() => { switchFamily(fam.family_id); setShowFamilySwitcher(false) }}
                    style={{
                      width: '100%', padding: '14px 16px', borderRadius: 16,
                      background: isActive ? 'linear-gradient(135deg, #951345, #720D35)' : '#F8F7FF',
                      border: isActive ? 'none' : '1.5px solid #EDE9FF',
                      color: isActive ? '#fff' : '#0D0C1D',
                      fontWeight: isActive ? 800 : 600, fontSize: 14,
                      fontFamily: 'inherit', cursor: isActive ? 'default' : 'pointer',
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                      boxShadow: isActive ? '0 6px 20px rgba(149,19,69,0.35)' : 'none',
                    }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: isActive ? 'rgba(255,255,255,0.18)' : '#F0EEFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="7" r="3" fill={isActive ? '#fff' : '#951345'}/>
                        <path d="M3 20C3 16.134 5.686 13 9 13C12.314 13 15 16.134 15 20H3Z" fill={isActive ? '#fff' : '#951345'}/>
                        <circle cx="17.5" cy="8.5" r="2.2" fill={isActive ? 'rgba(255,255,255,0.7)' : '#C0185A'}/>
                        <path d="M13.5 20C13.5 17.239 15.239 15 17.5 15C19.761 15 21.5 17.239 21.5 20H13.5Z" fill={isActive ? 'rgba(255,255,255,0.7)' : '#C0185A'}/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>{fam.name}</div>
                      <div style={{ fontSize: 11, opacity: isActive ? 0.75 : 0.5, fontWeight: 500 }}>
                        {fam.role === 'admin' ? '👑 Admin' : '👤 Member'} · {fam.invite_code}
                      </div>
                    </div>
                    {isActive && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', position: 'relative', zIndex: 1 }}>
        <div style={{ flex: 1 }}>
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
                    <button
                      onClick={() => { setNewFamilyName(familyName); setEditingFamilyName(true) }}
                      title="Rename family"
                      style={{
                        background: 'rgba(255,255,255,0.14)',
                        border: '1px solid rgba(255,255,255,0.28)',
                        borderRadius: 8, cursor: 'pointer',
                        padding: '4px 7px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.18s',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, zIndex: 1 }}>

        {/* Switch Family button — right side, matches Clear Chat style */}
        {allFamilies.length > 1 && (
          <button
            onClick={() => setShowFamilySwitcher(true)}
            style={{
              background: 'rgba(255,255,255,0.92)',
              border: '1.5px solid #fff',
              color: '#951345',
              borderRadius: 10,
              padding: '7px 12px',
              fontWeight: 800,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
              zIndex: 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            Switch
          </button>
        )}
        </div>
        </div>
      </div>

      <PullToRefresh onRefresh={loadData}>
      {/* minHeight 100% + flex column so the decorative illustration at the
          bottom can take the leftover space with marginTop:auto. With a long
          member list there is no leftover space and it simply follows the
          list, adding no scroll of its own. */}
      <div
        className="page-content-inner"
        style={{
          padding: '18px 16px', minHeight: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
        }}
      >

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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.3, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Family members ({members.length})
          <span style={{ fontSize: 10, color: 'var(--muted2)', fontWeight: 500 }}>
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
            const loc = locations[m.user_id] || {}
            // No `|| loc.updatedAt` fallback: a location timestamp says the
            // device is still reporting, not that the person has the app open.
            // Using it here is what made a closed app read "Online · Just now".
            const online = isOnline(m) && m.show_online !== false
            const lastSeen = formatLastSeen(m.last_active)
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
                    <div className="avatar" style={{ background: m.avatar_color && m.avatar_color !== '#4F8EF7' ? m.avatar_color : AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
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
                      <span>No activity yet</span>
                    )}
                  </div>
                </div>

                {/* Location sharing indicator — right side */}
                <div style={{
                  marginLeft: 'auto', flexShrink: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3,
                  alignSelf: 'flex-start', paddingTop: 4,
                  minWidth: 64,
                }}>
                  {/* Three distinct location states, because "not sharing" and
                      "phone GPS switched off" are different problems with
                      different fixes, and previously both looked the same:
                        sharing + GPS on  → green pin, "Live"
                        sharing + GPS off → RED pin,   "No GPS"
                        not sharing       → grey pin + red X, "Off"
                      gpsOff is only meaningful while sharing is on — with
                      sharing off the device stops reporting the flag at all. */}
                  {(() => {
                    const sharing = !!loc?.isSharing
                    const gpsOff  = sharing && loc?.locEnabled === false
                    const pinFill = !sharing ? '#D1D5DB' : (gpsOff ? '#E11D48' : '#10B981')
                    const label   = !sharing ? 'Off' : (gpsOff ? 'No GPS' : 'Live')
                    const labelColor = sharing && !gpsOff ? '#10B981' : '#E11D48'
                    return (
                      <>
                        <div style={{ position: 'relative', width: 28, height: 28 }}>
                          {/* Map pin SVG */}
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                              fill={pinFill} />
                            <circle cx="12" cy="9" r="2.5" fill="#fff" />
                          </svg>
                          {/* Strike-through X overlay when not sharing */}
                          {!sharing && (
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
                          color: labelColor,
                        }}>
                          {label}
                        </span>
                      </>
                    )
                  })()}
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
                  {(() => {
                    // Battery has been collected and stored since the location
                    // service landed, but was never surfaced anywhere.
                    const pct = loc?.battery
                    if (pct == null || Number.isNaN(pct)) return null
                    const level = Math.max(0, Math.min(100, Math.round(pct)))
                    const charging = !!loc?.isCharging
                    // The app's muted rose, already used for secondary text
                    // elsewhere on this screen. Full maroon was too heavy for a
                    // supporting detail and competed with the member name; grey
                    // would read as disabled. Green is avoided because it sat
                    // beside the green "Live" pin and the two merged.
                    const color = '#9C6B7A'
                    // This reading is only as fresh as the last location write.
                    // A member who stopped sharing keeps their last value
                    // forever, and since a battery only drains, a stale number
                    // always reads higher than reality. Fade it rather than
                    // hide it — "last known 2%" is worth knowing, "currently
                    // 2%" would be a lie. presenceTick re-renders every 15s so
                    // this stays current.
                    const stale = loc?.updatedAt
                      ? (Date.now() - new Date(loc.updatedAt)) > 15 * 60 * 1000
                      : true
                    return (
                      <span
                        title={stale ? 'Last known battery — this member has not reported recently' : undefined}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 800, color, marginTop: 3, whiteSpace: 'nowrap',
                          opacity: stale ? 0.55 : 1,
                        }}>
                        <svg width="21" height="12" viewBox="0 0 26 14" fill="none" aria-hidden="true">
                          <rect x="1" y="1" width="21" height="12" rx="3"
                            stroke={color} strokeWidth="2" />
                          {/* Minimum 2px of fill so a nearly-flat battery still
                              reads as "some charge" rather than an empty shell. */}
                          <rect x="3.5" y="3.5" width={Math.max(2, (level / 100) * 16)} height="7" rx="1.5" fill={color} />
                          <path d="M24 5 v4" stroke={color} strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        {level}%{charging ? ' ⚡' : ''}
                      </span>
                    )
                  })()}
                </div>

              </div>
            )
          })
        )}

        {/* Decorative filler for the empty space below a short member list */}
        {/* paddingBottom clears the invite FAB, which sits 18px up and is 56px
            tall. Without it the button lands on the right-hand parent figure and
            the artwork reads as damaged rather than decorative. */}
        <div style={{
          marginTop: 'auto', paddingTop: 30, paddingBottom: 84,
          display: 'flex', justifyContent: 'center', flexShrink: 0,
        }}>
          <FamilyIllustration />
        </div>
      </div>
      </PullToRefresh>

      {selectedMember && (
        <MemberPopup
          member={selectedMember}
          isSelf={selectedMember.user_id === user?.id}
          onClose={() => setSelectedMember(null)}
          onVoiceCall={() => handleStartCall(selectedMember, 'voice')}
          onVideoCall={() => handleStartCall(selectedMember, 'video')}
        />
      )}

      {/* ── Invite FAB ── */}
      {/* Absolute inside this page's root, which ends where the bottom nav
          begins, so it floats clear of the nav without needing its height. */}
      {inviteCode && (
        <button
          onClick={() => setShowInviteSheet(true)}
          title="Invite a family member"
          aria-label="Invite a family member"
          style={{
            position: 'absolute', right: 18, bottom: 18, zIndex: 20,
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #951345, #720D35)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(149,19,69,0.42)',
            padding: 0,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      )}
    </div>
  )
}
