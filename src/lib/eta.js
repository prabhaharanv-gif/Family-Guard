// Distance and arrival-time helpers.
//
// The arrival time itself no longer comes from here. It used to be worked out from the
// straight-line distance and a table of speeds, which gave answers like a 15-day drive
// across an ocean, and a bus time for places with no buses. Real times now come from
// Google Maps (see lib/travelTimes.js and the travel-times edge function). What is left
// is the straight-line distance, still used for "is this person effectively here" and
// as the fallback distance, and the formatting of an arrival moment.

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null)) return null
  const R = 6371
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * An arrival moment as text: just the clock time when it is still today ("01:50 PM"),
 * with the date in front once it is not ("3 Oct, 01:50 PM"). A bare time on a trip that
 * ends tomorrow reads as if it were today, which is wrong.
 */
export function arrivalTextAt(ts, now = Date.now()) {
  const at = new Date(ts)
  const today = new Date(now)
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === today.toDateString()) return time
  const date = at.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${date}, ${time}`
}

/**
 * A rough arrival time from the straight-line distance, for when Google has not
 * answered (no route service configured, an outage). It is only a stand-in, so
 * callers show it with a "~". Road distance is the straight line stretched by
 * 1.3 (1.2 past 25 km); speed rises with distance, from 5 km/h on foot to
 * 48 km/h on highways. Beyond 500 km nothing is guessed: a straight line across
 * that far says nothing about the road. Returns { arriveAt, minutes } or null.
 */
export function estimateArrival(km, now = Date.now()) {
  if (km == null || !Number.isFinite(km) || km < 0.15 || km > 500) return null
  const road = km * (km > 25 ? 1.2 : 1.3)
  const speed = road < 0.8 ? 5 : road < 3 ? 15 : road < 8 ? 22 : road < 20 ? 30 : road < 45 ? 40 : 48
  const minutes = Math.max(1, Math.round((road / speed) * 60))
  return { arriveAt: now + minutes * 60000, minutes }
}
