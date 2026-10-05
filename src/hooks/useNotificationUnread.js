import { useEffect, useState, useCallback } from 'react'
import { getUnreadCount, isNotificationLogAvailable } from '../lib/notificationLog'

/**
 * How many notifications arrived since the person last opened the bell. Re-read when the
 * app comes back to the front and on a slow timer, because a push can land while the
 * Family tab is open and nothing on the web side hears about it.
 */
export function useNotificationUnread() {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!isNotificationLogAvailable()) return
    setCount(await getUnreadCount())
  }, [])

  useEffect(() => {
    if (!isNotificationLogAvailable()) return
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(refresh, 15000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [refresh])

  return count
}
