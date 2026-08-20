import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Updates last_active every 60s while the app is open (not just on map)
export function useHeartbeat(userId, familyId) {
  useEffect(() => {
    if (!userId || !familyId) return

    const beat = async () => {
      await supabase.from('family_members')
        .update({ last_active: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('family_id', familyId)
    }

    beat() // immediately on mount
    const interval = setInterval(beat, 60000) // every 60s
    return () => clearInterval(interval)
  }, [userId, familyId])
}
