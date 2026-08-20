import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import MemberPopup from '../components/MemberPopup'

const AVATAR_COLORS = ['#4F46E5','#7C3AED','#EC4899','#F59E0B','#10B981','#0EA5E9','#F43F5E']

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

// SOS blink overlay
function SOSAlert({ alert, memberName, onDismiss }) {
  return (
    <div className="sos-blink-overlay" onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon">🆘</div>
        <div className="sos-alert-title">
          {memberName || 'A family member'} Is In Trouble!
        </div>
        <div className="sos-alert-sub">
          {alert.message || 'SOS Alert'}
          {alert.lat !== 0 && (
            <><br />
              <a
                href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
              >
                📍 View Location
              </a>
            </>
          )}
        </div>
        <button className="sos-alert-dismiss" onClick={onDismiss}>
          ✋ I Understand — Dismiss
        </button>
      </div>
    </div>
  )
}

export default function FamilyPage() {
  const { user, familyId, familyName, inviteCode, updateFamilyName } = useAuthStore()
  const [members, setMembers] = useState([])
  const [locations, setLocations] = useState({})
  const [joinRequests, setJoinRequests] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [newFamilyName, setNewFamilyName] = useState('')
  // Long-press name editing
  const [editingMember, setEditingMember] = useState(null)
  const [editMemberName, setEditMemberName] = useState('')
  const [savingMember, setSavingMember] = useState(false)
  // SOS alert
  const [sosAlert, setSosAlert] = useState(null)
  const [sosAlertMember, setSosAlertMember] = useState(null)
  const longPressTimer = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!familyId) return

    supabase.from('family_members').select('*').eq('family_id', familyId)
      .then(({ data }) => { if (data) setMembers(data) })

    supabase.from('locations').select('user_id, updated_at, is_sharing')
      .eq('family_id', familyId)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(l => { map[l.user_id] = { updatedAt: l.updated_at, isSharing: l.is_sharing } })
          setLocations(map)
        }
      })

    supabase.from('join_requests').select('*')
      .eq('family_id', familyId).eq('status', 'pending')
      .then(({ data }) => { if (data) setJoinRequests(data) })

    const channel = supabase
      .channel(`family-page:${familyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'join_requests',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        setJoinRequests(prev => [payload.new, ...prev])
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'join_requests',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        setJoinRequests(prev => prev.filter(r => r.id !== payload.new.id))
        if (payload.new.status === 'accepted') {
          supabase.from('family_members').select('*').eq('family_id', familyId)
            .then(({ data }) => { if (data) setMembers(data) })
        }
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'locations',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (payload.new) {
          setLocations(prev => ({
            ...prev,
            [payload.new.user_id]: { updatedAt: payload.new.updated_at, isSharing: payload.new.is_sharing }
          }))
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'family_members',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (payload.new) {
          setMembers(prev => prev.map(m =>
            m.user_id === payload.new.user_id
              ? { ...m, last_active: payload.new.last_active, avatar_url: payload.new.avatar_url || m.avatar_url, display_name: payload.new.display_name }
              : m
          ))
        }
      })
      // SOS real-time alert
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'sos_alerts',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (payload.new && payload.new.user_id !== user?.id) {
          setSosAlert(payload.new)
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  // Resolve SOS member name when alert fires
  useEffect(() => {
    if (!sosAlert) { setSosAlertMember(null); return }
    const m = members.find(m => m.user_id === sosAlert.user_id)
    setSosAlertMember(m?.display_name || 'A family member')
  }, [sosAlert, members])

  const handleAccept = async (request) => {
    try {
      await supabase.from('family_members').insert({
        family_id: familyId,
        user_id: request.requester_id,
        display_name: request.requester_name,
        role: 'member',
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      })
      await supabase.from('join_requests')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', request.id)
      alert(`✅ ${request.requester_name} added to family!`)
    } catch (err) { alert('Error: ' + err.message) }
  }

  const handleReject = async (request) => {
    await supabase.from('join_requests')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', request.id)
  }

  const handleSaveName = async () => {
    if (!newFamilyName.trim()) return
    try { await updateFamilyName(familyId, newFamilyName.trim()); setEditingName(false) }
    catch (err) { alert(err.message); setEditingName(false) }
  }

  // Long press handlers
  const startLongPress = useCallback((member) => {
    longPressTimer.current = setTimeout(() => {
      setEditingMember(member)
      setEditMemberName(member.display_name)
    }, 600)
  }, [])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }, [])

  const handleSaveMemberName = async () => {
    if (!editMemberName.trim() || !editingMember) return
    setSavingMember(true)
    try {
      await supabase.from('family_members')
        .update({ display_name: editMemberName.trim() })
        .eq('id', editingMember.id)
      setMembers(prev => prev.map(m =>
        m.id === editingMember.id ? { ...m, display_name: editMemberName.trim() } : m
      ))
      setEditingMember(null)
    } catch (err) { alert(err.message) }
    setSavingMember(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* SOS Blink Alert */}
      {sosAlert && (
        <SOSAlert
          alert={sosAlert}
          memberName={sosAlertMember}
          onDismiss={() => setSosAlert(null)}
        />
      )}

      {/* Edit Member Name Modal */}
      {editingMember && (
        <div className="overlay" onClick={() => setEditingMember(null)}>
          <div className="popup" onClick={e => e.stopPropagation()}>
            <div className="popup-handle" />
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Edit Name for {editingMember.display_name}
            </div>
            <input
              className="input"
              value={editMemberName}
              onChange={e => setEditMemberName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveMemberName()}
              autoFocus
              placeholder="Enter name or nickname"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setEditingMember(null)}
                style={{
                  flex: 1, padding: 14, borderRadius: 14,
                  background: 'var(--surface3)', border: '1.5px solid var(--border)',
                  color: 'var(--text2)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                }}
              >Cancel</button>
              <button
                onClick={handleSaveMemberName}
                disabled={savingMember}
                style={{
                  flex: 1, padding: 14, borderRadius: 14,
                  background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                  border: 'none', color: '#fff', fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  boxShadow: '0 4px 16px rgba(79,70,229,0.35)',
                }}
              >{savingMember ? 'Saving...' : 'Save Name'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar — no Leave button here */}
      <div className="top-bar">
        <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" value={newFamilyName}
                onChange={e => setNewFamilyName(e.target.value)}
                style={{ padding: '6px 12px', fontSize: 15, flex: 1 }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSaveName()} />
              <button onClick={handleSaveName} style={{
                background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 8, padding: '6px 12px', fontWeight: 700,
                cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              }}>Save</button>
              <button onClick={() => setEditingName(false)} style={{
                background: 'none', border: 'none', borderRadius: 8,
                padding: '6px 10px', cursor: 'pointer', fontSize: 16, color: 'rgba(255,255,255,0.7)',
              }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="top-bar-title">{familyName}</div>
                  <button onClick={() => { setNewFamilyName(familyName); setEditingName(true) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.45)', padding: 0 }}>✏️</button>
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

      <div className="page-content">

        {/* Join Requests */}
        {joinRequests.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ color: 'var(--rose)' }}>
              🔔 Join Requests ({joinRequests.length})
            </div>
            {joinRequests.map(req => (
              <div key={req.id} style={{
                background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
                borderRadius: 18, padding: 16, marginBottom: 10,
                border: '1.5px solid rgba(245,158,11,0.3)',
                boxShadow: '0 4px 16px rgba(245,158,11,0.12)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 18,
                    boxShadow: '0 4px 12px rgba(245,158,11,0.35)',
                  }}>
                    {req.requester_name[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{req.requester_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      Wants to join · {new Date(req.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleAccept(req)} style={{
                    flex: 1, padding: '11px', borderRadius: 12,
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 14,
                    boxShadow: '0 4px 12px rgba(16,185,129,0.35)',
                  }}>✅ Accept</button>
                  <button onClick={() => handleReject(req)} style={{
                    flex: 1, padding: '11px', borderRadius: 12,
                    background: '#fff', color: 'var(--rose)',
                    border: '1.5px solid rgba(244,63,94,0.3)', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>❌ Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Members */}
        <div className="section-title">
          Family Members ({members.length})
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            · Long press name to edit
          </span>
        </div>

        {members.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">👨‍👩‍👧‍👦</div>
            <div className="empty-text">No members yet</div>
            <div className="empty-sub">Share your family code to add members</div>
          </div>
        ) : (
          members.map((m, i) => {
            const loc = locations[m.user_id]
            const activeTs = m.last_active || loc?.updatedAt || null
            const online = isOnline(activeTs)
            const lastSeen = formatLastSeen(activeTs)
            return (
              <div
                key={m.id}
                className="member-card"
                onClick={() => setSelectedMember(m)}
                onMouseDown={() => startLongPress(m)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(m)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.display_name} style={{
                      width: 50, height: 50, borderRadius: '50%', objectFit: 'cover',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    }} />
                  ) : (
                    <div className="avatar" style={{ background: m.avatar_color || AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {m.display_name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  {/* Online indicator on avatar */}
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
                  <div className="member-name" style={{ color: 'var(--text)' }}>{m.display_name}</div>
                  <div className="member-meta" style={{ color: 'var(--muted)' }}>
                    {online ? (
                      <span style={{ color: '#10B981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 6px #10B981' }} />
                        Online
                      </span>
                    ) : lastSeen ? (
                      <span>Last seen {lastSeen}</span>
                    ) : (
                      <span>Not yet active</span>
                    )}
                    {m.phone && <span style={{ marginLeft: 6 }}>· {m.phone}</span>}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {selectedMember && (
        <MemberPopup
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          onViewLocation={(m) => {
            setSelectedMember(null)
            navigate(`/map/${m.user_id}`)
          }}
        />
      )}
    </div>
  )
}
