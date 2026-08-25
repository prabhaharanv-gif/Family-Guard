import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { cacheSet, cacheGet } from './useOfflineCache'

export function useLocations(familyId) {
  const [locations, setLocations] = useState(() => cacheGet(`locations:${familyId}`) || {})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!familyId) return

    async function fetch() {
      const [{ data: locs }, { data: members }] = await Promise.all([
        supabase.from('locations')
          .select('user_id, lat, lng, updated_at, is_sharing, battery_level, is_charging, speed')
          .eq('family_id', familyId).eq('is_sharing', true),
        supabase.from('family_members')
          .select('user_id, display_name, avatar_color, avatar_url')
          .eq('family_id', familyId),
      ])

      if (locs && members) {
        const memberMap = {}
        members.forEach(m => { memberMap[m.user_id] = m })
        const map = {}
        locs.forEach(l => {
          if (!l.lat || !l.lng || (l.lat === 0 && l.lng === 0)) return
          const m = memberMap[l.user_id] || {}
          map[l.user_id] = {
            lat: l.lat, lng: l.lng,
            updatedAt:   l.updated_at,
            displayName: m.display_name || 'Member',
            avatarColor: m.avatar_color || '#4F8EF7',
            avatarUrl:   m.avatar_url || null,
            isSharing:   l.is_sharing,
            battery:     l.battery_level ?? null,
            isCharging:  l.is_charging ?? false,
            speed:       l.speed ?? null,
          }
        })
        setLocations(map)
        cacheSet(`locations:${familyId}`, map)
      }
      setLoading(false)
    }

    fetch()

    const channel = supabase.channel(`locations:${familyId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'locations',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        const l = payload.new
        if (!l || !l.is_sharing) return
        if (!l.lat || !l.lng || (l.lat === 0 && l.lng === 0)) return
        setLocations(prev => {
          const updated = {
            ...prev,
            [l.user_id]: {
              ...prev[l.user_id],
              lat: l.lat, lng: l.lng,
              updatedAt:  l.updated_at,
              isSharing:  l.is_sharing,
              battery:    l.battery_level ?? prev[l.user_id]?.battery ?? null,
              isCharging: l.is_charging ?? false,
              speed:      l.speed ?? null,
            }
          }
          cacheSet(`locations:${familyId}`, updated)
          return updated
        })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  return { locations, loading }
}
