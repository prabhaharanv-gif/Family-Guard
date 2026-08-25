import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Updates last_active every 60s while the app is open.
// Uses RPC upsert_location pattern — the update is filtered by auth.uid()
// server-side via RLS, so a malicious client can't update another user's row.
export function useHeartbeat(userId, familyId) {
  useEffect(() => {
    if (!userId || !familyId) return

    const beat = async () => {
      // RLS ensures user_id = auth.uid() — cannot fake another user's heartbeat
      // SECURE: update_member_heartbeat RPC — only updates last_active for auth.uid()
      await supabase.rpc('update_member_heartbeat', { p_family_id: familyId })
    }

    beat()
    const interval = setInterval(beat, 60_000)
    return () => clearInterval(interval)
  }, [userId, familyId])
}
