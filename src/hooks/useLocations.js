import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { cacheSet, cacheGet } from './useOfflineCache'

export function useLocations(familyId) {
  const [locations, setLocations] = useState(() => cacheGet(`locations:${familyId}`) || {})
  const [loading, setLoading]     = useState(true)
  // Keep a ref of the latest locations map so the realtime handler always
  // has access to the current state without stale closure issues.
  const locationsRef = useRef(locations)
  useEffect(() => { locationsRef.current = locations }, [locations])

  useEffect(() => {
    if (!familyId) return

    // Guards a family switch: an in-flight fetch for the previous family must
    // not resolve afterwards and repaint the map with the old family's members
    // while the UI already says the new one.
    let cancelled = false

    async function fetchAll() {
      const [{ data: locs }, { data: members }] = await Promise.all([
        supabase
          .from('locations')
          .select('user_id, lat, lng, updated_at, is_sharing, battery_level, is_charging, speed')
          .eq('family_id', familyId)
          .eq('is_sharing', true),
        supabase
          .from('family_members')
          .select('user_id, display_name, avatar_color, avatar_url')
          .eq('family_id', familyId),
      ])

      if (cancelled) return
      if (locs && members) {
        const memberMap = {}
        members.forEach(m => { memberMap[m.user_id] = m })
        const map = {}
        locs.forEach(l => {
          if (!l.lat || !l.lng || (l.lat === 0 && l.lng === 0)) return
          // Only people who are still in this family. A removed member keeps
          // their row in `locations` — nothing deletes it — and this used to
          // fall back to `|| {}`, so they carried on as a pin labelled
          // "Member" long after being taken out of the family. The member list
          // is the authority on who belongs here; a location with nobody
          // behind it is not a person to draw.
          const m = memberMap[l.user_id]
          if (!m) return
          map[l.user_id] = {
            lat:         l.lat,
            lng:         l.lng,
            updatedAt:   l.updated_at,
            displayName: m.display_name || 'Member',
            avatarColor: m.avatar_color || '#951345',
            avatarUrl:   m.avatar_url   || null,
            isSharing:   l.is_sharing,
            battery:     l.battery_level ?? null,
            isCharging:  l.is_charging   ?? false,
            speed:       l.speed         ?? null,
          }
        })
        setLocations(map)
        cacheSet(`locations:${familyId}`, map)
      }
      if (!cancelled) setLoading(false)
    }

    fetchAll()

    // ── Real-time: listen for ANY change to the locations table ──────────────
    // IMPORTANT: Do NOT filter on is_sharing here — Supabase postgres_changes
    // UPDATE payloads only include changed columns, so is_sharing can be
    // undefined (falsy) even when location sharing is on. Instead we re-fetch
    // the full row from the DB whenever a change arrives, which guarantees we
    // always have the complete, authoritative data.
    const channel = supabase
      .channel(`locations-rt:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'locations', filter: `family_id=eq.${familyId}` },
        async (payload) => {
          const uid = payload.new?.user_id || payload.old?.user_id
          if (!uid) return

          // Re-fetch the single updated row so we always have the full record
          const { data: rows } = await supabase
            .from('locations')
            .select('user_id, lat, lng, updated_at, is_sharing, battery_level, is_charging, speed')
            .eq('family_id', familyId)
            .eq('user_id', uid)
            .single()

          if (!rows) {
            // Row deleted — remove from map
            setLocations(prev => {
              const next = { ...prev }
              delete next[uid]
              cacheSet(`locations:${familyId}`, next)
              return next
            })
            return
          }

          // Not sharing — remove pin
          if (!rows.is_sharing || !rows.lat || !rows.lng || (rows.lat === 0 && rows.lng === 0)) {
            setLocations(prev => {
              if (!prev[uid]) return prev
              const next = { ...prev }
              delete next[uid]
              cacheSet(`locations:${familyId}`, next)
              return next
            })
            return
          }

          // Fetch member info (from current state to avoid extra DB call most of the time)
          const existing = locationsRef.current[uid]
          const memberInfo = existing
            ? { displayName: existing.displayName, avatarColor: existing.avatarColor, avatarUrl: existing.avatarUrl }
            : await supabase
                .from('family_members')
                .select('display_name, avatar_color, avatar_url')
                .eq('family_id', familyId)
                .eq('user_id', uid)
                .single()
                .then(({ data: m }) => (m ? {
                  displayName: m.display_name || 'Member',
                  avatarColor: m.avatar_color || '#951345',
                  avatarUrl:   m.avatar_url   || null,
                } : null))

          // Same rule as the initial load above: no member record, no pin. A
          // location update from someone who has been removed from the family
          // is not a person to put back on the map.
          if (!memberInfo) return

          setLocations(prev => {
            const next = {
              ...prev,
              [uid]: {
                lat:         rows.lat,
                lng:         rows.lng,
                updatedAt:   rows.updated_at,
                displayName: memberInfo.displayName,
                avatarColor: memberInfo.avatarColor,
                avatarUrl:   memberInfo.avatarUrl,
                isSharing:   rows.is_sharing,
                battery:     rows.battery_level ?? prev[uid]?.battery ?? null,
                isCharging:  rows.is_charging   ?? false,
                speed:       rows.speed         ?? null,
              },
            }
            cacheSet(`locations:${familyId}`, next)
            return next
          })
        }
      )
      .subscribe((status) => {
        // If the channel fails to subscribe, fall back to polling every 30s
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[useLocations] Realtime channel error — falling back to polling')
        }
      })

    // ── Polling fallback: refresh every 30 s in case realtime drops ──────────
    // This ensures the map stays accurate even if the WebSocket disconnects.
    const pollTimer = setInterval(fetchAll, 30_000)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      clearInterval(pollTimer)
    }
  }, [familyId])

  return { locations, loading }
}
