import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'
import { useLocations } from '../hooks/useLocations'
import { useNicknames } from '../hooks/useNicknames'
import { supabase } from '../lib/supabase'
import { startBatteryReporting } from '../hooks/useBattery'
import { formatLocationTime } from '../lib/locationTime'
import Icon from '../components/Icon'
import LeafletFamilyMap from '../components/map/LeafletFamilyMap'
import NativeFamilyMap from '../components/map/NativeFamilyMap'

// Google's native map in the Android app (free to display); Leaflet +
// OpenStreetMap in the browser, so the web never uses the billed Google Maps
// JavaScript API. Everything below is shared — only the drawing differs.
const FamilyMap = Capacitor.isNativePlatform() ? NativeFamilyMap : LeafletFamilyMap

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
// 34, not 28, and the unit is set at 8px rather than 6.
//
// Android's WebView floors font-size at 8px: measured on the device, text set
// to 6px, 7px and 8px all render identically at 23.4px wide for "KM/H". The
// old badge asked for 6px and got 8px, which does not fit a 24px inner circle
// — at the unit's line the available width is about 20px — so the label spilled
// out over the edge and read as cut off. Sizing the circle for the text that
// actually renders is what fixes it; asking for a smaller font cannot.
function SpeedBadge({ loc, size = 34 }) {
  const kmh = speedKmh(loc)
  if (kmh == null) return null
  return (
    <div style={{
      // Pushed out along the down-right diagonal so it clips only the very edge
      // of the avatar. Closer in, the bubble ate most of the lower-right
      // quadrant and buried the face.
      position: 'absolute', right: -14, bottom: -8,
      width: size, height: size, borderRadius: '50%',
      background: 'var(--maroon)', border: '2px solid #fff',
      boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: '#fff', lineHeight: 1,
      boxShadow: '0 2px 6px rgba(139,13,61,0.45)',
      pointerEvents: 'none',
      // Nothing may leave the circle, whatever the platform does to the font.
      overflow: 'hidden',
    }}>
      <span style={{
        fontSize: kmh >= 100 ? 11 : 13, fontWeight: 900,
        letterSpacing: -0.3, whiteSpace: 'nowrap',
      }}>{kmh}</span>
      <span style={{
        fontSize: 8, fontWeight: 800, letterSpacing: 0,
        marginTop: 1, whiteSpace: 'nowrap',
      }}>KM/H</span>
    </div>
  )
}

export default function MapAllPage() {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const { locations: rawLocations } = useLocations(familyId)
  // My nicknames applied once, here, so every name on this page — the markers
  // and their letters, the Find Fam list, the Following chip — matches the
  // Family cards and chat. They read the registered name before.
  const { nicknames } = useNicknames()
  const locations = useMemo(() => {
    if (!Object.keys(nicknames).length) return rawLocations
    const out = {}
    for (const [uid, loc] of Object.entries(rawLocations)) {
      out[uid] = nicknames[uid] ? { ...loc, displayName: nicknames[uid] } : loc
    }
    return out
  }, [rawLocations, nicknames])
  const batteryRef = useRef({ level: null, charging: false })

  useEffect(() => {
    const stop = startBatteryReporting(b => { batteryRef.current = b })
    return stop
  }, [])
  const [refreshing, setRefreshing]   = useState(false)
  const [showFindFam, setShowFindFam] = useState(false)
  const [flyTarget, setFlyTarget]     = useState(null)  // { lat, lng } to fly to
  // Whose marker to keep on screen. A uid rather than coordinates: the point is
  // to track wherever they are now, not where they were when the row was tapped.
  const [followUid, setFollowUid]       = useState(null)
  // Dragging the map pauses following instead of ending it. Looking around
  // should not silently undo the thing you asked for, and the chip over the map
  // offers it straight back.
  const [followPaused, setFollowPaused] = useState(false)
  // Map mode — default / satellite / traffic. Always opens on Default (by
  // request); the choice is not remembered between visits.
  const [mapMode, setMapMode] = useState('default')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const pauseFollowing = useCallback(() => setFollowPaused(true), [])
  const stopFollowing  = useCallback(() => { setFollowUid(null); setFollowPaused(false) }, [])
  const startFollowing = useCallback(uid => { setFollowUid(uid); setFollowPaused(false) }, [])
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

      // On Android the foreground service is the position writer, behind its
      // accuracy and jump filters, and useLocationBroadcast copies its filtered
      // fix to the other families. This page used to write a fix of its own on
      // every open and Refresh — unfiltered, and via a low-accuracy fallback —
      // which dropped a Wi-Fi guess ~100m off over the service's GPS position.
      if (Capacitor.isNativePlatform()) return

      const pos = await getPositionRobust()
      // Web: the same ceiling the other writers use; a worse fix is noise.
      if (pos.coords.accuracy != null && pos.coords.accuracy > 100) return
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

  // Pins with members at the same spot fanned out so each can be tapped.
  const pins = useMemo(() => offsetOverlapping(locations), [locations])

  // What tapping a pin shows: a Leaflet popup on the web, a card on the phone.
  // Compact on purpose: who this is, and a way to get to them. The
  // last-location time and speed live in the Find Fam list — repeated here it
  // doubled the popup's height and covered the map.
  //
  // The button asks Google Maps for DIRECTIONS rather than just showing the
  // spot: the map is already a Google map, so "open in Google Maps" added
  // nothing, and what someone tapping a family member usually wants is to get
  // to them. It is a plain link (the Maps app picks it up), so it costs nothing.
  // The destination is the member's REAL position — pins of members standing
  // together are fanned out on screen, and directions must not route to the
  // fanned-out spot. No button on your own pin: directions to yourself are noise.
  const renderMemberPopup = (uid, loc) => {
    const real = locations[uid] || loc
    const isMe = uid === user?.id
    return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isMe ? 0 : 8 }}>
        <div style={{ flexShrink: 0 }}>
          {loc.avatarUrl ? (
            <img src={loc.avatarUrl} alt={loc.displayName} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '2px solid var(--maroon)' }} />
          ) : (
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: loc.avatarColor || 'var(--maroon)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 13,
              border: '2px solid var(--maroon)', boxSizing: 'border-box',
            }}>
              {loc.displayName?.[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap' }}>{loc.displayName}</div>
          {/* How far they are from you — the same figure Find Fam shows,
              measured to their REAL position, not the fanned-out pin. */}
          {!isMe && myLoc && (() => {
            const dist = formatDistance(myLoc.lat, myLoc.lng, real.lat, real.lng)
            return dist ? (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--maroon)', whiteSpace: 'nowrap' }}>{dist}</div>
            ) : null
          })()}
        </div>
      </div>
      {/* Directions — sized to its label, not stretched across the card */}
      {!isMe && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${real.lat},${real.lng}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
            color: '#fff', padding: '7px 14px', borderRadius: 999,
            fontWeight: 700, fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          <Icon name="navigate" /> {t('map.directionsTo', { name: loc.displayName })}
        </a>
      )}
    </div>
    )
  }

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
          <div className="top-bar-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
            {t('map.title')}
          </div>
        </div>
        {/* Find Fam button — styled exactly like Messages' "Clear Chat": the
            solid white pill is the header's primary action on both pages. */}
        <button
          onClick={() => setShowFindFam(s => !s)}
          aria-label={t('map.findMember')}
          style={{
            background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff',
            color: 'var(--maroon)', borderRadius: 10, padding: '7px 12px',
            fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
            marginRight: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          {t('map.findFam')}
        </button>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label={t('map.refresh')}
          // Same translucent square and icon as the Messages refresh button.
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: 10,
            padding: '7px 10px', cursor: refreshing ? 'wait' : 'pointer',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'famguard-spin 0.7s linear infinite' : 'none' }}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
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
          <Icon name="alert" /> {t('map.permissionRequired')}
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
          <Icon name="alert" /> {t('map.locationFailed')}
        </div>
      )}

      {/* Map */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <FamilyMap
          pins={pins}
          locations={locations}
          flyTarget={flyTarget}
          followLoc={followUid ? locations[followUid] : null}
          following={!!followUid && !followPaused}
          onUserPanned={pauseFollowing}
          renderPopup={renderMemberPopup}
          mapMode={mapMode}
        />

        {/* Map mode dropdown, top-right of the map (it sat top-left under the
            title for a while, where it got in the way).
            Phone only: satellite imagery and the traffic layer are Google's,
            which the browser's OpenStreetMap map does not have. The button
            shows the mode in use; open, the list offers only the two OTHER
            modes, always in the fixed order Default, Traffic, Satellite so
            nothing jumps around between visits. Cream with maroon text
            throughout. Satellite is Google's "hybrid": imagery with street
            names on top. */}
        {Capacitor.isNativePlatform() && (() => {
          const MODES = [
            { mode: 'default',   label: t('map.defaultView') },
            { mode: 'traffic',   label: t('map.trafficView') },
            { mode: 'satellite', label: t('map.satelliteView') },
          ]
          const current = MODES.find(o => o.mode === mapMode) || MODES[0]
          const scheme = { bg: '#FFF8F0', fg: 'var(--maroon)' }
          const pill = (o, extra) => ({
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: o.bg, color: o.fg,
            border: '1.5px solid var(--maroon)', borderRadius: 999,
            padding: '7px 13px', minWidth: 104,
            boxShadow: '0 2px 10px rgba(74,8,32,0.18)',
            fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
            whiteSpace: 'nowrap',
            ...extra,
          })
          return (
            <>
              {/* Tap anywhere else to close. Transparent, and only there while
                  open, so the map pans normally the rest of the time. */}
              {modeMenuOpen && (
                <div onClick={() => setModeMenuOpen(false)}
                  style={{ position: 'absolute', inset: 0, zIndex: 399 }} />
              )}
              <div style={{
                position: 'absolute', top: 12, right: 12, zIndex: 400,
                display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8,
              }}>
                <button
                  onClick={() => setModeMenuOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={modeMenuOpen}
                  style={pill(scheme)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                  {current.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    style={{ transform: modeMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {modeMenuOpen && (
                  <div role="listbox" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {MODES.filter(o => o.mode !== mapMode).map(o => (
                      <button
                        key={o.mode}
                        role="option"
                        aria-selected={false}
                        onClick={() => { setMapMode(o.mode); setModeMenuOpen(false) }}
                        style={pill(scheme)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* Following chip.
            The first version tracked silently, so there was no way to tell
            "following is on" from "following is broken" — and a stray drag
            turned it off with nothing on screen to say so. This states which
            member is being followed, says when a drag has paused it, and offers
            it back in one tap without reopening Find Fam. */}
        {followUid && locations[followUid] && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)',
            zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8,
            background: followPaused ? '#FFFFFF' : 'var(--grad-maroon)',
            color: followPaused ? 'var(--text)' : '#fff',
            border: followPaused ? '1.5px solid var(--border2)' : 'none',
            borderRadius: 999, padding: '8px 8px 8px 14px',
            boxShadow: '0 6px 20px rgba(74,8,32,0.28)',
            fontSize: 12.5, fontWeight: 700, maxWidth: '86%',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {followPaused
                ? t('map.followPaused', { name: locations[followUid].displayName })
                : t('map.following',    { name: locations[followUid].displayName })}
            </span>
            {followPaused && (
              <button
                onClick={() => startFollowing(followUid)}
                style={{
                  background: 'var(--grad-maroon)', color: '#fff', border: 'none',
                  borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 800,
                  fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
                }}>{t('map.followResume')}</button>
            )}
            <button
              onClick={stopFollowing}
              aria-label={t('map.followStop')}
              style={{
                background: followPaused ? 'var(--surface3)' : 'rgba(255,255,255,0.22)',
                color: followPaused ? 'var(--text2)' : '#fff',
                border: 'none', borderRadius: '50%', width: 24, height: 24,
                fontSize: 14, lineHeight: '24px', fontFamily: 'inherit',
                cursor: 'pointer', flexShrink: 0, padding: 0,
              }}>x</button>
          </div>
        )}
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
            border: '1px solid var(--border)',
            minWidth: 200, maxWidth: 260,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{t('map.findMemberTitle')}</span>
            </div>

            {/* Member list */}
            {Object.entries(locations).length === 0 ? (
              <div style={{ padding: '16px', fontSize: 13, color: 'var(--muted-soft)', textAlign: 'center' }}>
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
                      startFollowing(uid)
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
                          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '2px solid var(--maroon)' }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: loc.avatarColor || 'var(--maroon)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 800, fontSize: 15,
                          border: '2px solid var(--maroon)', boxSizing: 'border-box',
                        }}>
                          {loc.displayName?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <SpeedBadge loc={loc} />
                    </div>
                    {/* Name + distance + last loc time */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        {loc.displayName}
                        {myLoc && uid !== user?.id && (() => {
                          const dist = formatDistance(myLoc.lat, myLoc.lng, loc.lat, loc.lng)
                          return dist ? (
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--maroon)' }}>
                              ({dist})
                            </span>
                          ) : null
                        })()}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: stale ? '#D97706' : 'var(--muted)' }}>
                        {stale ? <><Icon name="alert" />{' '}</> : ''}{t('map.lastLocTime')} · {formatLocationTime(t, loc.updatedAt)}
                      </div>
                    </div>
                    {/* Arrow */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
