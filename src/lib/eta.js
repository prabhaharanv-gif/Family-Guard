// Rough arrival time between two people, worked out from the straight-line
// distance — free, instant, and shown as "Reach by 01:50 PM".
// Real road time (with traffic) is one tap away in Google Maps.
//
// Longer trips are faster per kilometre (highways, fewer junctions), so the
// speed grows with distance instead of one city figure for everything. A flat
// 22 km/h gave 2 h 29 min for a 42 km drive that really takes about 1 h 10 min.
//
//   road distance ≈ straight line × 1.3 (× 1.2 beyond 25 km, roads run straighter)
//   road km  < 0.8   on foot, 5 km/h
//            < 3     city streets, 15 km/h
//            < 8     city, 22 km/h
//            < 20    town and ring roads, 30 km/h
//            < 45    mixed, 40 km/h
//            else    highway, 48 km/h
//
// Inside 150 m there is no ETA worth showing: they are effectively there.

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

export function etaMinutes(km) {
  if (km == null || km < 0.15) return null
  const road = km * (km > 25 ? 1.2 : 1.3)
  const speed = road < 0.8 ? 5 : road < 3 ? 15 : road < 8 ? 22 : road < 20 ? 30 : road < 45 ? 40 : 48
  const min = (road / speed) * 60
  // A figure this rough should not look precise: to the nearest 5 minutes
  // once it is past 10.
  return min < 10 ? Math.max(1, Math.round(min)) : Math.round(min / 5) * 5
}

/** "Reach by 01:50 PM" — the clock time of arrival, or null when there is nothing worth saying. */
export function etaLabel(t, km) {
  const min = etaMinutes(km)
  if (min == null) return null
  const time = new Date(Date.now() + min * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return t('map.destReachBy', { time })
}

/** Rough road distance in km from a straight-line one (same factor etaMinutes uses). */
export function roadKm(km) {
  return km == null ? null : km * (km > 25 ? 1.2 : 1.3)
}
