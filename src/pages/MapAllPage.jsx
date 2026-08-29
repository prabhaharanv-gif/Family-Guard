import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Geolocation } from '@capacitor/geolocation'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'
import { supabase } from '../lib/supabase'
import { startBatteryReporting } from '../hooks/useBattery'
import SmoothMarker from '../components/SmoothMarker'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function createIcon(color, initial, avatarUrl) {
  const content = avatarUrl
    ? `<img src="${avatarUrl}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.25);" />`
    : `<div style="
        width:44px;height:44px;border-radius:50%;
        background:${color};border:3px solid #fff;
        display:flex;align-items:center;justify-content:center;
        font-weight:800;font-size:18px;color:#fff;
        box-shadow:0 2px 12px rgba(0,0,0,0.25);
        font-family:Inter,sans-serif;
      ">${initial}</div>`
  return L.divIcon({
    className: '',
    html: content,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

/**
 * offsetOverlapping
 *
 * When two or more members are near the same spot (e.g. same house), their
 * markers stack on top of each other making them impossible to tap or even
 * see as separate pins. This nudges each duplicate slightly in a circle so
 * all pins are visible.
 *
 * IMPORTANT: Groups by real-world distance (metres), not exact string-matched
 * lat/lng. GPS noise means two people standing together rarely report the
 * EXACT same coordinate down to the 6th decimal place — one might be
 * 11.154897 and the other 11.154898, a difference of about half a metre.
 * Comparing raw toFixed(6) strings treats these as different, so no offset
 * was ever applied and the pins silently overlapped. Grouping by distance
 * catches this.
 *
 * Returns a new map: uid → { ...loc, lat, lng } with offsets applied.
 * Members with unique positions are untouched.
 */
const OVERLAP_THRESHOLD_M = 20   // members within this distance are treated as "same spot"

function distanceMetersRaw(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function offsetOverlapping(locations) {
  const OFFSET_M = 0.00015   // ~16 metres per step — visible but not jarring
  const entries  = Object.entries(locations)
  const result   = {}
  const grouped  = new Set()   // uids already assigned to a cluster

  entries.forEach(([uid, loc], i) => {
    if (grouped.has(uid)) return

    // Find every other member within OVERLAP_THRESHOLD_M of this one
    const cluster = [[uid, loc]]
    entries.forEach(([uid2, loc2], j) => {
      if (i === j || grouped.has(uid2)) return
      const d = distanceMetersRaw(loc.lat, loc.lng, loc2.lat, loc2.lng)
      if (d <= OVERLAP_THRESHOLD_M) cluster.push([uid2, loc2])
    })

    cluster.forEach(([u]) => grouped.add(u))

    if (cluster.length === 1) {
      result[uid] = loc
      return
    }

    // Spread markers in a circle: angle evenly spaced, first one stays centred
    cluster.forEach(([u, l], idx) => {
      if (idx === 0) { result[u] = l; return }
      const angle     = (2 * Math.PI * idx) / cluster.length
      const offsetLat = OFFSET_M * Math.cos(angle)
      const offsetLng = OFFSET_M * Math.sin(angle) / Math.cos(l.lat * Math.PI / 180)
      result[u] = { ...l, lat: l.lat + offsetLat, lng: l.lng + offsetLng }
    })
  })

  return result
}

// Flies the map to a specific member when flyTarget changes
// Haversine distance between two lat/lng points — returns human-readable string
function formatDistance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat  = toRad(lat2 - lat1)
  const dLng  = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  if (dist < 50)   return 'Nearby'
  if (dist < 1000) return `${Math.round(dist)} m away`
  return `${(dist / 1000).toFixed(1)} km away`
}

function FlyToMember({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 17, { animate: true, duration: 1.0 })
  }, [target])
  return null
}

function FitAll({ locations }) {
  const map = useMap()
  const hasFit = useRef(false)

  useEffect(() => {
    // Only auto-fit on the very first load so the map doesn't jump around
    // while members are moving in real-time.
    if (hasFit.current) return
    const coords = Object.values(locations).map(l => [l.lat, l.lng])
    if (coords.length === 0) return
    hasFit.current = true
    if (coords.length === 1) map.setView(coords[0], 15)
    else map.fitBounds(coords, { padding: [60, 60] })
  }, [locations])

  return null
}

// Below this, a reading is GPS noise rather than movement — a phone sitting on
// a table reports a wandering 1-3 km/h, and showing that would have members
// permanently "moving". Walking pace is ~5 km/h, so 4 is a safe floor.
const MIN_DISPLAY_SPEED_KMH = 4
// A speed is a snapshot from the instant of the fix, so it goes stale far
// faster than the position does. "72 km/h" next to a 20-minute-old fix is
// worse than showing nothing.
const SPEED_FRESH_MS = 3 * 60 * 1000

/**
 * Movement label for a member, or null when there is nothing worth showing.
 * locations.speed is km/h — see the writers in useLocationBroadcast.js and
 * LocationForegroundService.java.
 */
function speedKmh(loc) {
  if (loc?.speed == null) return null
  if (Date.now() - new Date(loc.updatedAt) > SPEED_FRESH_MS) return null
  const kmh = Number(loc.speed)
  if (!Number.isFinite(kmh) || kmh < MIN_DISPLAY_SPEED_KMH) return null
  return Math.round(kmh)
}

/**
 * Maroon speed bubble that overlaps the bottom-right of an avatar.
 *
 * Rendered only while the member is actually moving, so the avatar sits clean
 * the rest of the time. The parent must be position:relative and should leave
 * room on that corner — the bubble deliberately spills outside the avatar
 * circle rather than covering the face.
 */
function SpeedBadge({ loc, size = 28 }) {
  const kmh = speedKmh(loc)
  if (kmh == null) return null
  return (
    <div style={{
      // Pushed out along the down-right diagonal so it clips only the very edge
      // of the avatar. Closer in, the bubble ate most of the lower-right
      // quadrant and buried the face.
      position: 'absolute', right: -16, bottom: -10,
      width: size, height: size, borderRadius: '50%',
      background: '#951345', border: '2px solid #fff',
      boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: '#fff', lineHeight: 1,
      boxShadow: '0 2px 6px rgba(149,19,69,0.45)',
      pointerEvents: 'none',
    }}>
      <span style={{ fontSize: kmh >= 100 ? 9 : 11, fontWeight: 900, letterSpacing: -0.3 }}>{kmh}</span>
      <span style={{ fontSize: 6, fontWeight: 800, letterSpacing: 0.2, marginTop: 1 }}>KM/H</span>
    </div>
  )
}

export default function MapAllPage() {
  const { user, familyId } = useAuthStore()
  const { locations } = useLocations(familyId)
  const batteryRef = useRef({ level: null, charging: false })

  useEffect(() => {
    const stop = startBatteryReporting(b => { batteryRef.current = b })
    return stop
  }, [])
  const [refreshing, setRefreshing]   = useState(false)
  const [showFindFam, setShowFindFam] = useState(false)
  const [flyTarget, setFlyTarget]     = useState(null)  // { lat, lng } to fly to
  // null   = not yet tried (no banner)
  // 'perm' = permission denied
  // 'fail' = GPS failed AND no locations in DB yet (only show if map is empty)
  const [locErrorType, setLocErrorType] = useState(null)

  const updateLocation = async (lat, lng, accuracy, speed) => {
    const { data: memberPref } = await supabase.from('family_members').select('show_location')
      .eq('user_id', user.id).eq('family_id', familyId).single()
    const sharingOn = !(memberPref && memberPref.show_location === false)

    if (!sharingOn) {
      await supabase.from('locations').upsert({
        user_id: user.id, family_id: familyId,
        is_sharing: false, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,family_id' })
      return
    }

    await supabase.rpc('upsert_location_with_battery', {
      p_family_id:   familyId,
      p_lat:         lat,
      p_lng:         lng,
      p_accuracy:    accuracy || 0,
      // locations.speed is km/h (what LocationForegroundService writes); the
      // Geolocation API hands us metres/second, so convert rather than mixing
      // two units into one column.
      p_speed:       speed == null || Number.isNaN(speed) ? null : speed * 3.6,
      p_battery:     batteryRef.current.level ?? null,
      p_is_charging: batteryRef.current.charging ?? false,
    })
  }

  const getPositionRobust = async () => {
    // Attempt 1: high accuracy native GPS
    try {
      return await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 20000, maximumAge: 30000,
      })
    } catch (e1) {
      console.warn('[Map] High-accuracy fix failed:', e1?.message)
    }
    // Attempt 2: low accuracy, accept up to 5-min cached fix
    // (covers battery-optimised devices that throttle GPS cold start)
    try {
      return await Geolocation.getCurrentPosition({
        enableHighAccuracy: false, timeout: 25000, maximumAge: 300000,
      })
    } catch (e2) {
      console.warn('[Map] Low-accuracy fix failed:', e2?.message)
    }
    // Attempt 3: browser geolocation (fallback for web/desktop)
    return await new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return }
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: false, timeout: 25000, maximumAge: 300000 }
      )
    })
  }

  const startTracking = async () => {
    setLocErrorType(null)
    try {
      const perm = await Geolocation.requestPermissions()
      if (perm.location !== 'granted') {
        setLocErrorType('perm')
        return
      }

      const pos = await getPositionRobust()
      // Got a fix — clear any previous error and write once.
      // NOTE: continuous location writing is handled globally by
      // useLocationBroadcast (in App.jsx), which runs whenever the app is
      // open on any platform. Here we just do a one-shot write so tapping
      // Refresh gives an immediate fresh fix.
      setLocErrorType(null)
      await updateLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed)
    } catch (e) {
      console.warn('[Map] GPS failed:', e?.message)
      // Only show the error banner if the map itself is also empty.
      setLocErrorType('fail')
    }
  }

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await startTracking()
    } finally {
      setTimeout(() => setRefreshing(false), 600)
    }
  }

  useEffect(() => {
    if (!user || !familyId) return
    startTracking()
    // No watch cleanup needed here anymore — continuous tracking lives in
    // the global useLocationBroadcast hook.
  }, [user, familyId])

  const memberCount = Object.keys(locations).length
  // Current user's own location — used to calculate distance to other members
  const myLoc = user?.id ? locations[user.id] : null

  // Only show the GPS error banner when the map is empty AND we have an error.
  // If locations are already visible, the GPS error is a background update
  // failure — showing a red banner while the map works perfectly is misleading.
  const showPermError = locErrorType === 'perm'
  const showGpsError  = locErrorType === 'fail' && memberCount === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top Bar */}
      <div className="top-bar" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div className="top-bar-title">🗺️ Family Map</div>
          <div className="top-bar-sub">{memberCount} member{memberCount !== 1 ? 's' : ''} sharing location</div>
        </div>
        {/* Find Fam button */}
        <button
          onClick={() => setShowFindFam(s => !s)}
          aria-label="Find family member"
          style={{
            background: showFindFam ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.15)',
            border: '1.5px solid rgba(255,255,255,0.4)',
            color: showFindFam ? '#951345' : '#fff',
            borderRadius: 10, padding: '8px 14px',
            fontWeight: 800, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer',
            whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
            marginRight: 6,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Find Fam
        </button>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh map"
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1.5px solid #fff',
            color: '#951345', borderRadius: 10,
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: refreshing ? 'wait' : 'pointer', flexShrink: 0,
          }}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'famguard-spin 0.7s linear infinite' : 'none' }}
          >
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <style>{`@keyframes famguard-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      {/* Permission denied — always show (user must fix it) */}
      {showPermError && (
        <div style={{
          background: '#FEF2F2', color: '#B91C1C',
          borderBottom: '1px solid #FCA5A5',
          padding: '9px 16px', fontSize: 12.5, fontWeight: 600,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ Location permission is required. Allow it in Android Settings → Apps → Famora → Permissions.
        </div>
      )}

      {/* GPS fail — only show when map is empty so it's not shown over a working map */}
      {showGpsError && (
        <div style={{
          background: '#FEF2F2', color: '#B91C1C',
          borderBottom: '1px solid #FCA5A5',
          padding: '9px 16px', fontSize: 12.5, fontWeight: 600,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ Couldn't get location — check GPS is on and tap Refresh.
        </div>
      )}

      {/* Map */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapContainer
          center={[11.0168, 76.9558]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitAll locations={locations} />
          <FlyToMember target={flyTarget} />

          {Object.entries(offsetOverlapping(locations)).map(([uid, loc]) => (
            <SmoothMarker
              key={uid}
              position={[loc.lat, loc.lng]}
              icon={createIcon(
                loc.avatarColor || '#951345',
                loc.displayName?.[0]?.toUpperCase() || '?',
                loc.avatarUrl || null
              )}
            >
              <div style={{ minWidth: 160, fontFamily: 'Inter, sans-serif', padding: '2px 0' }}>
                  {/* Avatar + name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ position: 'relative', flexShrink: 0, marginRight: 14 }}>
                      {loc.avatarUrl ? (
                        <img src={loc.avatarUrl} alt={loc.displayName} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '2px solid #951345' }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: loc.avatarColor || '#951345',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 800, fontSize: 15,
                          border: '2px solid #951345', boxSizing: 'border-box',
                        }}>
                          {loc.displayName?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <SpeedBadge loc={loc} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0D0C1D' }}>{loc.displayName}</div>
                      <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                        Last Loc Time · {new Date(loc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {/* Stale warning — if location is older than 15 minutes */}
                      {(Date.now() - new Date(loc.updatedAt)) > 15 * 60 * 1000 && (
                        <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700, marginTop: 3 }}>
                          ⚠️ Location may be outdated
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Google Maps button */}
                  <a
                    href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'linear-gradient(135deg, #951345, #720D35)',
                      color: '#fff', padding: '8px 14px', borderRadius: 10,
                      fontWeight: 700, fontSize: 12, textDecoration: 'none',
                      boxShadow: '0 3px 10px rgba(149,19,69,0.3)',
                    }}
                  >
                    🗺️ Open in Google Maps
                  </a>
                </div>
            </SmoothMarker>
          ))}
        </MapContainer>
      </div>

      {/* Find Fam popup */}
      {showFindFam && (
        <>
          {/* Backdrop — tap outside to close */}
          <div
            onClick={() => setShowFindFam(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 399 }}
          />
          <div style={{
            position: 'absolute', top: 70, right: 12, zIndex: 400,
            background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            border: '1px solid #F0E4EA',
            minWidth: 200, maxWidth: 260,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, #951345, #720D35)',
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Find Family Member</span>
            </div>

            {/* Member list */}
            {Object.entries(locations).length === 0 ? (
              <div style={{ padding: '16px', fontSize: 13, color: '#9C6B7A', textAlign: 'center' }}>
                No members sharing location
              </div>
            ) : (
              Object.entries(locations).map(([uid, loc]) => {
                const stale = (Date.now() - new Date(loc.updatedAt)) > 15 * 60 * 1000
                return (
                  <button
                    key={uid}
                    onClick={() => {
                      setFlyTarget({ lat: loc.lat, lng: loc.lng })
                      setShowFindFam(false)
                    }}
                    style={{
                      width: '100%', padding: '11px 14px',
                      background: 'none', border: 'none',
                      borderBottom: '1px solid #F8F0F4',
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 10,
                      textAlign: 'left',
                    }}
                  >
                    {/* Avatar, with the speed bubble overlapping its corner.
                        marginRight leaves room for the part of the bubble that
                        spills outside the avatar, so it never collides with the
                        name text beside it. */}
                    <div style={{ position: 'relative', flexShrink: 0, marginRight: 14 }}>
                      {loc.avatarUrl ? (
                        <img src={loc.avatarUrl} alt={loc.displayName}
                          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '2px solid #951345' }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: loc.avatarColor || '#951345',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 800, fontSize: 15,
                          border: '2px solid #951345', boxSizing: 'border-box',
                        }}>
                          {loc.displayName?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <SpeedBadge loc={loc} />
                    </div>
                    {/* Name + distance + last loc time */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0C1D', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        {loc.displayName}
                        {myLoc && uid !== user?.id && (() => {
                          const dist = formatDistance(myLoc.lat, myLoc.lng, loc.lat, loc.lng)
                          return dist ? (
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#951345' }}>
                              ({dist})
                            </span>
                          ) : null
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: stale ? '#D97706' : '#9C6B7A' }}>
                        {stale ? '⚠️ ' : ''}Last Loc Time · {new Date(loc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {/* Arrow */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#951345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
