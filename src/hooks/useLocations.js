import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useLocations(familyId) {
  const [locations, setLocations] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!familyId) return

    async function fetch() {
      const { data } = await supabase
        .from('locations')
        .select('user_id, lat, lng, updated_at, is_sharing, family_members(display_name, avatar_color)')
        .eq('family_id', familyId)
        .eq('is_sharing', true)

      if (data) {
        const map = {}
        data.forEach(l => {
          map[l.user_id] = {
            lat: l.lat, lng: l.lng,
            updatedAt: l.updated_at,
            displayName: l.family_members?.display_name,
            avatarColor: l.family_members?.avatar_color || '#4F8EF7',
          }
        })
        setLocations(map)
      }
      setLoading(false)
    }

    fetch()

    const channel = supabase
      .channel(`locations:${familyId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'locations',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        const l = payload.new
        if (!l) return
        setLocations(prev => ({
          ...prev,
          [l.user_id]: { ...prev[l.user_id], lat: l.lat, lng: l.lng, updatedAt: l.updated_at }
        }))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  return { locations, loading }
}
