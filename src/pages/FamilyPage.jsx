import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import MemberPopup from '../components/MemberPopup'

const AVATAR_COLORS = ['#4F8EF7','#FF6B6B','#34C759','#FF9500','#AF52DE','#FF2D55','#5AC8FA']

export default function FamilyPage() {
  const { user, familyId, familyName, inviteCode, updateFamilyName } = useAuthStore()
  const [members, setMembers] = useState([])
  const [joinRequests, setJoinRequests] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [newFamilyName, setNewFamilyName] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!familyId) return

    // Load members
    supabase.from('family_members').select('*').eq('family_id', familyId)
      .then(({ data }) => { if (data) setMembers(data) })

    // Load pending join requests for this family
    supabase.from('join_requests').select('*')
      .eq('family_id', familyId).eq('status', 'pending')
      .then(({ data }) => { if (data) setJoinRequests(data) })

    // Real-time: new join requests
    const channel = supabase
      .channel(`join-requests:${familyId}`)
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
          // Reload members
          supabase.from('family_members').select('*').eq('family_id', familyId)
            .then(({ data }) => { if (data) setMembers(data) })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  const handleAccept = async (request) => {
    try {
      // Add to family members
      await supabase.from('family_members').insert({
        family_id: familyId,
        user_id: request.requester_id,
        display_name: request.requester_name,
        role: 'member',
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      })

      // Update request status
      await supabase.from('join_requests')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', request.id)

      alert(`✅ ${request.requester_name} has been added to your family!`)
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handleReject = async (request) => {
    await supabase.from('join_requests')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', request.id)
  }

  const handleSaveName = async () => {
    if (!newFamilyName.trim()) return
    await updateFamilyName(familyId, newFamilyName.trim())
    setEditingName(false)
  }

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode)
    alert(`Invite code copied: ${inviteCode}`)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Bar */}
      <div className="top-bar">
        <div style={{ flex: 1 }}>
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" value={newFamilyName}
                onChange={e => setNewFamilyName(e.target.value)}
                style={{ padding: '6px 12px', fontSize: 15, flex: 1 }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSaveName()} />
              <button onClick={handleSaveName} style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '6px 12px', fontWeight: 700,
                cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              }}>Save</button>
              <button onClick={() => setEditingName(false)} style={{
                background: 'var(--bg)', border: 'none', borderRadius: 8,
                padding: '6px 10px', cursor: 'pointer', fontSize: 13,
              }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div>
                <div className="top-bar-title">🛡️ FamilyGuard</div>
                <div className="top-bar-sub">{familyName}</div>
              </div>
              <button onClick={() => { setNewFamilyName(familyName); setEditingName(true) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)' }}
                title="Edit family name">✏️</button>
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={() => navigate('/add-member')} title="Add Member">➕</button>
      </div>

      <div className="page-content">

        {/* Join Requests - shown to admin */}
        {joinRequests.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ color: 'var(--red)' }}>
              🔔 Join Requests ({joinRequests.length})
            </div>
            {joinRequests.map(req => (
              <div key={req.id} style={{
                background: '#fff',
                borderRadius: 14,
                padding: 14,
                marginBottom: 10,
                border: '1.5px solid var(--orange)',
                boxShadow: '0 2px 12px rgba(255,149,0,0.1)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'var(--orange)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 18,
                  }}>
                    {req.requester_name[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{req.requester_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Wants to join your family · {new Date(req.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleAccept(req)} style={{
                    flex: 1, padding: '10px', borderRadius: 10,
                    background: 'var(--green)', color: '#fff',
                    border: 'none', fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 14,
                  }}>✅ Accept</button>
                  <button onClick={() => handleReject(req)} style={{
                    flex: 1, padding: '10px', borderRadius: 10,
                    background: '#fff', color: 'var(--red)',
                    border: '1.5px solid var(--red)', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  }}>❌ Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invite Code */}
        <div className="invite-card" onClick={copyCode}>
          <div className="invite-label">Your Family Invite Code</div>
          <div className="invite-code">{inviteCode}</div>
          <div className="invite-hint">📋 Tap to copy & share with family</div>
        </div>

        {/* Members */}
        <div className="section-title">Family Members ({members.length})</div>

        {members.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">👨‍👩‍👧‍👦</div>
            <div className="empty-text">No members yet</div>
            <div className="empty-sub">Share your invite code or tap ➕ to add members</div>
          </div>
        ) : (
          members.map((m, i) => (
            <div key={m.id} className="member-card" onClick={() => setSelectedMember(m)}>
              <div className="avatar" style={{ background: m.avatar_color || AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {m.display_name?.[0]?.toUpperCase()}
              </div>
              <div className="member-info">
                <div className="member-name">{m.display_name}</div>
                <div className="member-meta">
                  {m.relationship && `${m.relationship}`}
                  {m.phone && ` · ${m.phone}`}
                  {m.bet_name && ` · "${m.bet_name}"`}
                </div>
              </div>
              <div className={`status-dot ${m.is_online ? 'status-online' : 'status-offline'}`} />
            </div>
          ))
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
