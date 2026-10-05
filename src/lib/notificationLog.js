/**
 * notificationLog.js
 *
 * Family tab -> bell: the last seven days of notifications, kept on the phone so that
 * swiping one away does not lose it. The native side (NotificationLog) records each
 * notification as it is shown, in the phone's language at the time, so the text here is
 * displayed as it came. Chat messages are not logged: the Messages tab is their history.
 *
 * Android only. On the web there is nothing recorded, so every call returns empty.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

const NotificationLog = registerPlugin('NotificationLog')

export const isNotificationLogAvailable = () => Capacitor.isNativePlatform()

/** Which line icon each kind of notification gets. */
export const TYPE_ICON = {
  sos:                 'siren',
  sos_resolved:        'checkCircle',
  ping:                'radio',
  join_request:        'users',
  place_enter:         'pin',
  place_exit:          'pin',
  device_alert:        'phone',
  weather_alert:       'wCloud',
  unlock_alert:        'lock',
  nearby_help_request: 'help',
  nearby_help_status:  'help',
}

/** Red for the ones that mean someone may be in danger, maroon for the rest. */
export const URGENT_TYPES = new Set(['sos', 'nearby_help_request'])

/** The saved history, newest first, and when the person last looked. */
export async function getNotificationLog() {
  if (!isNotificationLogAvailable()) return { items: [], seenAt: 0 }
  try {
    const r = await NotificationLog.getAll()
    return { items: Array.isArray(r?.items) ? r.items : [], seenAt: Number(r?.seenAt) || 0 }
  } catch {
    return { items: [], seenAt: 0 }
  }
}

export async function getUnreadCount() {
  if (!isNotificationLogAvailable()) return 0
  try {
    const r = await NotificationLog.getUnreadCount()
    return Number(r?.count) || 0
  } catch {
    return 0
  }
}

export async function markAllSeen() {
  if (!isNotificationLogAvailable()) return
  try { await NotificationLog.markAllSeen() } catch { /* an older build without the plugin */ }
}

export async function clearNotificationLog() {
  if (!isNotificationLogAvailable()) return
  try { await NotificationLog.clear() } catch { /* an older build without the plugin */ }
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * Splits a newest-first list into days: [{ day: 'today' | 'yesterday' | 'earlier', date, items }].
 * `date` is the day's local midnight, for labelling an 'earlier' group.
 */
export function groupByDay(items, now = Date.now()) {
  const todayStart = startOfDay(new Date(now))
  const yesterdayStart = startOfDay(new Date(todayStart - 12 * 60 * 60 * 1000))
  const groups = []
  for (const it of items) {
    const dayStart = startOfDay(new Date(it.t))
    let day = 'earlier'
    if (dayStart >= todayStart) day = 'today'
    else if (dayStart === yesterdayStart) day = 'yesterday'
    const last = groups[groups.length - 1]
    if (last && last.date === dayStart) last.items.push(it)
    else groups.push({ day, date: dayStart, items: [it] })
  }
  return groups
}
