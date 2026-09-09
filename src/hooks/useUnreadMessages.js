/**
 * useUnreadMessages
 *
 * Tracks the unread message badge count for the bottom nav.
 * Increments when a message arrives from another member while
 * the user is NOT on the Messages page.
 * Resets to zero when the user navigates to /messages.
 *
 * Extracted from App.jsx.
 */

import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function useUnreadMessages(user, familyId) {
  const [unreadMessages, setUnreadMessages] = useState(0)
  const location = useLocation()

  // Clear badge when the user visits Messages
  useEffect(() => {
    if (location.pathname === '/messages') setUnreadMessages(0)
  }, [location.pathname])

  // Increment badge on new incoming messages
  useEffect(() => {
    if (!user || !familyId) return

    const channel = supabase
      .channel(`unread-msgs:${familyId}:${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'messages',
        filter: `family_id=eq.${familyId}`,
      }, (payload) => {
        if (
          payload.new.user_id !== user.id &&
          window.location.pathname !== '/messages'
        ) {
          const muteLevel = parseInt(localStorage.getItem('msg_mute_level') || '0', 10)
          if (muteLevel < 2) {
            setUnreadMessages(prev => prev + 1)
          }
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, familyId])

  return { unreadMessages }
}
