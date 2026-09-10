// Formatting for "when was this member last located".
//
// Both map screens used to print a bare clock time, so a fix from yesterday
// read exactly like one from an hour ago — "07:34 PM", with nothing to say
// which day it belonged to. On a screen whose whole job is telling you where
// someone is right now, that is the difference between reassuring and wrong.
//
// Anchor every stamp to a day: today and yesterday by name, anything older by
// date, with the year only once it stops being this one.
//
// SOSPage carries the same shape inline against the sos.* keys; this is the
// map-side pair, kept in one place so the two map screens cannot drift.
export function formatLocationTime(t, ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (d.toDateString() === now.toDateString()) return t('map.todayAt', { time })

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return t('map.yesterdayAt', { time })

  const date = d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${date}, ${time}`
}
