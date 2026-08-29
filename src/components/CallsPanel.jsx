/**
 * CallsPanel
 *
 * Call history for the Calls tab on the Messages page. Rows come from the
 * `calls` table, which RLS scopes to calls the viewer took part in.
 *
 * Clear / Delete live in the maroon top bar rather than in this panel, so they
 * sit exactly where "Clear Chat" does on the Chat tab. The panel reports its
 * state upward via `onControls` and MessagesPage renders the buttons.
 *
 * Selection: long-press a row to start selecting, then tap rows to toggle.
 * Only finished calls are selectable — an in-progress call must not be
 * deletable out from under its participants.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const FINISHED = ['ended', 'declined', 'missed']

function formatWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return `Yesterday · ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`
}

function formatDuration(sec) {
  if (sec == null) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function CallsPanel({ onDialog, onControls }) {
  const { user, familyId } = useAuthStore()
  const [calls, setCalls]       = useState([])
  const [names, setNames]       = useState({})
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const longPressRef = useRef(null)
  const didLongPress = useRef(false)

  const load = useCallback(async () => {
    if (!user || !familyId) return
    const [{ data: rows }, { data: members }] = await Promise.all([
      supabase.from('calls').select('*')
        .eq('family_id', familyId)
        .order('started_at', { ascending: false })
        .limit(200),
      supabase.from('family_members').select('user_id, display_name, avatar_url')
        .eq('family_id', familyId),
    ])
    const map = {}
    ;(members || []).forEach(m => { map[m.user_id] = m })
    setNames(map)
    setCalls(rows || [])
    setLoading(false)
  }, [user, familyId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!familyId) return
    const ch = supabase
      .channel(`calls-history:${familyId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `family_id=eq.${familyId}` },
        () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [familyId, load])

  const finishedCalls = calls.filter(c => FINISHED.includes(c.status))

  const exitSelection = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])

  const handleClearAll = useCallback(() => {
    onDialog?.({
      type: 'confirm',
      title: 'Clear Call History',
      message: 'This will delete the call history for everyone in this family and cannot be undone.',
      confirmLabel: 'Clear History',
      onConfirm: async () => {
        setBusy(true)
        const { error } = await supabase.rpc('clear_call_history', { p_family_id: familyId })
        if (!error) { setCalls([]); exitSelection() }
        setBusy(false)
      },
    })
  }, [familyId, onDialog, exitSelection])

  const handleDeleteSelected = useCallback(() => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    onDialog?.({
      type: 'confirm',
      title: `Delete ${ids.length} call${ids.length > 1 ? 's' : ''}?`,
      message: 'The selected calls will be removed for everyone in this family.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setBusy(true)
        const { error } = await supabase.rpc('delete_calls', { p_call_ids: ids })
        if (!error) setCalls(prev => prev.filter(c => !selected.has(c.id)))
        exitSelection()
        setBusy(false)
      },
    })
  }, [selected, onDialog, exitSelection])

  // Report state up so the maroon header can render the buttons.
  useEffect(() => {
    onControls?.({
      clearableCount: finishedCalls.length,
      selectedCount: selected.size,
      selectMode,
      busy,
      clearAll: handleClearAll,
      deleteSelected: handleDeleteSelected,
      cancelSelection: exitSelection,
    })
  }, [finishedCalls.length, selected, selectMode, busy,
      handleClearAll, handleDeleteSelected, exitSelection, onControls])

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      if (next.size === 0) setSelectMode(false)
      return next
    })
  }

  const startLongPress = (call) => {
    if (!FINISHED.includes(call.status)) return
    didLongPress.current = false
    longPressRef.current = setTimeout(() => {
      didLongPress.current = true
      try { if (navigator.vibrate) navigator.vibrate(40) } catch (e) {}
      setSelectMode(true)
      setSelected(new Set([call.id]))
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
      {selectMode && (
        <div style={{
          padding: '8px 16px', background: '#FDF0F5', borderBottom: '1px solid #F0E4EA',
          fontSize: 12, color: '#951345', fontWeight: 700,
        }}>
          {selected.size} selected · tap to select more
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#9C6B7A', fontSize: 13 }}>Loading…</div>
        ) : calls.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9C6B7A' }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>📞</div>
            <div style={{ fontWeight: 800, color: '#3A1020', marginBottom: 4 }}>No calls yet</div>
            <div style={{ fontSize: 13 }}>Voice and video calls will appear here</div>
          </div>
        ) : calls.map(c => {
          const outgoing = c.caller_id === user?.id
          const otherId  = outgoing ? c.callee_id : c.caller_id
          const other    = names[otherId]
          const name     = other?.display_name || 'Family member'
          const missed   = c.status === 'missed' || c.status === 'declined'
          const isVideo  = c.call_type === 'video'
          const isSel    = selected.has(c.id)

          return (
            <div
              key={c.id}
              onClick={() => {
                if (didLongPress.current) { didLongPress.current = false; return }
                if (selectMode && FINISHED.includes(c.status)) toggle(c.id)
              }}
              onMouseDown={() => startLongPress(c)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={() => startLongPress(c)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderBottom: '1px solid #F7F2F5',
                background: isSel ? '#FDF0F5' : 'transparent',
                cursor: selectMode ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              {selectMode && (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isSel ? '#951345' : '#D4C4CC'}`,
                  background: isSel ? '#951345' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 900,
                }}>{isSel ? '✓' : ''}</div>
              )}

              <div style={{
                width: 42, height: 42, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                background: '#951345', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16,
              }}>
                {other?.avatar_url
                  ? <img src={other.avatar_url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : name[0]?.toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 700, fontSize: 14,
                  color: missed ? '#DC2626' : '#0D0C1D',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{name}</div>
                <div style={{ fontSize: 12, color: '#8480B0', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>{isVideo ? '📹' : '📞'}</span>
                  <span>{outgoing ? '↗ Outgoing' : '↙ Incoming'}</span>
                  {c.status === 'missed'   && <span style={{ color: '#DC2626' }}>· Missed</span>}
                  {c.status === 'declined' && <span style={{ color: '#DC2626' }}>· Declined</span>}
                  {c.status === 'ended' && c.duration_seconds != null &&
                    <span>· {formatDuration(c.duration_seconds)}</span>}
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#9C6B7A', flexShrink: 0 }}>
                {formatWhen(c.started_at)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
