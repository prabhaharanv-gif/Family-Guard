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
import TimelinePanel from '../components/map/TimelinePanel'
import { buildRoute, clockLabel, dateLabel, daysBetween, distanceM, outwardDir, positionAt, rowsOnDay, timelineSince } from '../lib/route'
import { fetchLocationHistory } from '../lib/locationHistory'
import { etaLabel, haversineKm } from '../lib/eta'

// Google's native map in the Android app (free to display); Leaflet +
// OpenStreetMap in the browser, so the web never uses the billed Google Maps
// JavaScript API. Everything below is shared — only the drawing differs.
const FamilyMap = Capacitor.isNativePlatform() ? NativeFamilyMap : LeafletFamilyMap

// Timeline: the last fix counts as "Now" when it is this recent; older, and
// the end is labelled with its time instead, so a phone that went quiet at
// 2 PM does not claim they are there now.
const NOW_WINDOW_MS = 15 * 60 * 1000
// Start and end closer than this (a round trip from home) share one callout,
// stacked, instead of two boxes drawn over each other.
const ENDS_TOGETHER_M = 150
// Room the Timeline panel takes at the foot of the map (Times mode, the taller
// one), so the route is framed in the part of the map left visible. The week
// has one more row, the day picker.
const TIMELINE_INSET = { '24h': 210, '7d': 250 }

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
  const [showFindFam, setShowFindFam] = useState(false)
  const [flyTarget, setFlyTarget]     = useState(null)  // { lat, lng } to fly to
  // Whose marker to keep on screen. A uid rather than coordinates: the point is
  // to track wherever they are now, not where they were when the row was tapped.
  const [followUid, setFollowUid]       = useState(null)
  // Dragging the map pauses following instead of ending it. Looking around
  // should not silently undo the thing you asked for, and the chip over the map
  // offers it straight back.
  const [followPaused, setFollowPaused] = useState(false)
  // Map type — 'default' (road) or 'satellite' — plus the traffic layer, which
  // sits on top of either. Always opens on the road map with traffic off (by
  // request); the choice is not remembered between visits.
  const [mapMode, setMapMode] = useState('default')
  const [traffic, setTraffic] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  // Timeline: whose history is drawn, over which span, and what was loaded.
  const [routeUid, setRouteUid] = useState(null)
  // null | 'loading' | { rows (oldest first), since, until (ms) } | { failed: true }
  const [history, setHistory]   = useState(null)
  // '24h' | '7d' — see timelineSince. Opens on 24 h every time.
  const [timelineRange, setTimelineRange] = useState('24h')
  // Last 7 Days only: one day picked (its local midnight, ms), or null for all.
  // Picking a day filters what is already loaded — no second download.
  const [timelineDay, setTimelineDay] = useState(null)
  // 'route' = the line only; 'times' = plus the member's avatar at timelineTime.
  const [timelineMode, setTimelineMode] = useState('route')
  const [timelineTime, setTimelineTime] = useState(null)   // ms
  // Which load is current: a slow answer for someone tapped earlier must not
  // replace the timeline of the person tapped since.
  const routeReqRef = useRef(0)
  const loadTimeline = useCallback(async (uid, range) => {
    setHistory('loading')
    setTimelineDay(null)
    const req = ++routeReqRef.current
    const until = Date.now()
    const since = timelineSince(range, until)
    let rows
    try {
      rows = await fetchLocationHistory(supabase, {
        userId: uid, familyId,
        since: new Date(since).toISOString(), until: new Date(until).toISOString(),
      })
    } catch (e) {
      if (req !== routeReqRef.current) return
      console.warn('[Map] timeline load failed:', e?.message || e)
      setHistory({ failed: true })
      return
    }
    if (req !== routeReqRef.current) return
    setHistory({ rows, since, until })
  }, [familyId])
  // What is drawn: the whole span, or the picked day of it.
  const route = useMemo(() => {
    if (!history || history === 'loading') return history
    if (history.failed) return { ...buildRoute([]), failed: true }
    return buildRoute(timelineDay == null ? history.rows : rowsOnDay(history.rows, timelineDay))
  }, [history, timelineDay])
  // The week's days for the picker, each marked with whether it has any fixes.
  const timelineDays = useMemo(() => {
    if (timelineRange !== '7d' || !history?.rows) return null
    const has = new Set(history.rows.map(r => new Date(r.recorded_at).toDateString()))
    return daysBetween(history.since, history.until)
      .map(start => ({ start, has: has.has(new Date(start).toDateString()) }))
  }, [timelineRange, history])
  // Every new route opens Times on its latest moment: where they are, or where
  // they were last on the picked day.
  useEffect(() => {
    setTimelineTime(route?.track?.length ? route.track[route.track.length - 1].t : null)
  }, [route])
  const showRoute = useCallback((uid) => {
    // Following would keep yanking the camera back to their pin.
    setFollowUid(null); setFollowPaused(false)
    setRouteUid(uid)
    setTimelineMode('route')
    setTimelineRange('24h')
    loadTimeline(uid, '24h')
  }, [loadTimeline])
  // Switching span keeps Route or Times as it was.
  const changeTimelineRange = useCallback((range) => {
    if (!routeUid || range === timelineRange) return
    setTimelineRange(range)
    loadTimeline(routeUid, range)
  }, [routeUid, timelineRange, loadTimeline])
  const hideRoute = useCallback(() => {
    routeReqRef.current++
    setRouteUid(null); setHistory(null); setTimelineMode('route'); setTimelineRange('24h'); setTimelineDay(null)
  }, [])
  // The Timeline as drawn: one solid line per stretch with no gap, a dot
  // where they stayed, and the two ends marked — a ring and a "Start" box
  // where the span begins, a solid dot and a "Now" box where it ends. Every
  // dot and box can be tapped for directions. Text is made here, in the
  // chosen language.
  const drawnRoute = useMemo(() => {
    if (!route || route === 'loading' || route.path.length < 2) return null
    const am = t('map.am'), pm = t('map.pm')
    const first = route.track[0], last = route.track[route.track.length - 1]
    // With the date: the start is always an earlier day, often by a week.
    const when = ms => `${dateLabel(ms, t.lang)}, ${clockLabel(ms, am, pm)}`
    const startLabel = t('map.timelineStart', { time: when(first.t) })
    const endLabel = Date.now() - last.t < NOW_WINDOW_MS
      ? t('map.timelineNow')
      : t('map.timelineLast', { time: when(last.t) })
    const callout = (p, labels) => ({ lat: p.lat, lng: p.lng, labels, dir: outwardDir(p, route.path) })
    const callouts = distanceM(first, last) < ENDS_TOGETHER_M
      ? [callout(last, [startLabel, endLabel])]
      : [callout(first, [startLabel]), callout(last, [endLabel])]
    const spots = [
      ...route.stays.map(st => ({ kind: 'stay', lat: st.lat, lng: st.lng })),
      { kind: 'start', lat: first.lat, lng: first.lng },
      { kind: 'end', lat: last.lat, lng: last.lng },
    ]
    return { path: route.path, segments: route.segments, spots, callouts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, t.lang])
  // Times mode: the member's avatar where they were at the picked moment.
  const cursorAt = timelineMode === 'times' && drawnRoute && timelineTime != null
    ? positionAt(route.track, timelineTime) : null
  const routeMember = routeUid ? locations[routeUid] : null
  const routeCursor = useMemo(() => cursorAt && {
    lat: cursorAt.lat, lng: cursorAt.lng,
    displayName: routeMember?.displayName, avatarUrl: routeMember?.avatarUrl, avatarColor: routeMember?.avatarColor,
  }, [cursorAt?.lat, cursorAt?.lng, routeMember?.displayName, routeMember?.avatarUrl, routeMember?.avatarColor]) // eslint-disable-line react-hooks/exhaustive-deps
  // A different family, a different set of people: drop the old trail.
  useEffect(() => { hideRoute() }, [familyId, hideRoute])

  const pauseFollowing = useCallback(() => setFollowPaused(true), [])
  const stopFollowing  = useCallback(() => { setFollowUid(null); setFollowPaused(false) }, [])
  const startFollowing = useCallback(uid => { hideRoute(); setFollowUid(uid); setFollowPaused(false) }, [hideRoute])
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

  useEffect(() => {
    if (!user || !familyId) return
    startTracking()
    // No watch cleanup needed here anymore — continuous tracking lives in
    // the global useLocationBroadcast hook.
  }, [user, familyId])

  // Pins with members at the same spot fanned out so each can be tapped.
  // While a route is open no avatar pins are shown at all — not even that
  // member's own, which sat on the route's end and covered its last time box —
  // so the trail reads clearly; closing the route brings them all back.
  const pins = useMemo(
    () => (routeUid ? {} : offsetOverlapping(locations)),
    [locations, routeUid],
  )

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
  // close: from the native map card, so opening the route takes the card off
  // the line it would otherwise cover. The web popup closes on a map tap.
  const renderMemberPopup = (uid, loc, close) => {
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
            const eta = etaLabel(t, haversineKm(myLoc.lat, myLoc.lng, real.lat, real.lng))
            return dist ? (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--maroon)', whiteSpace: 'nowrap' }}>{dist}{eta ? ' · ' + eta : ''}</div>
            ) : null
          })()}
        </div>
      </div>
      {/* Directions and Timeline share one row, compact pills split evenly.
          The name is already at the top of the card, so labels can stay short. */}
      <div style={{ display: 'flex', gap: 6, marginTop: isMe ? 8 : 0 }}>
        {!isMe && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${real.lat},${real.lng}`}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              flex: 1, minWidth: 0,
              background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
              color: '#fff', padding: '6px 10px', borderRadius: 999,
              fontWeight: 700, fontSize: 11.5, textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            <Icon name="navigate" size={13} /> {t('map.directions')}
          </a>
        )}
        {/* Outline, so Directions stays the main action. */}
        <button
          onClick={() => { close?.(); showRoute(uid) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            flex: 1, minWidth: 0, boxSizing: 'border-box',
            background: '#FFF8F0', color: 'var(--maroon)',
            border: '1.5px solid var(--maroon)', padding: '6px 10px', borderRadius: 999,
            fontWeight: 700, fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <Icon name="map" size={13} /> {t('map.todaysRoute')}
        </button>
      </div>
    </div>
    )
  }

  // What tapping a dot, a box or the avatar on the Timeline shows: directions
  // to that spot and nothing else.
  const renderSpotPopup = spot => (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}
        target="_blank" rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
          color: '#fff', padding: '8px 14px', borderRadius: 999,
          fontWeight: 700, fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap',
        }}
      >
        <Icon name="navigate" /> {t('map.directions')}
      </a>
    </div>
  )

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

        {/* Map layers, where Refresh used to be. Refresh fetched nothing on the
            phone (pins update over realtime, and useLocations now re-fetches
            as soon as the app comes back to the front), so its slot went to
            the one map control, which then no longer covers the map. Same
            translucent square as the Messages refresh button. Phone only:
            satellite and traffic are Google's, not OpenStreetMap's. */}
        {Capacitor.isNativePlatform() && (
          <button
            onClick={() => setModeMenuOpen(o => !o)}
            aria-label={t('map.mapLayers')}
            aria-expanded={modeMenuOpen}
            style={{
              background: modeMenuOpen ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)',
              border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: 10,
              padding: '7px 10px', cursor: 'pointer',
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </button>
        )}
      </div>

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
          renderSpotPopup={renderSpotPopup}
          mapMode={mapMode}
          traffic={traffic}
          route={drawnRoute}
          routeCursor={routeCursor}
          routeInset={TIMELINE_INSET[timelineRange]}
        />

        {/* Map layers card, opened by the header's layers button and shown at
            the top-right of the map. (Before: a pill on the map plus two more
            pills when open, covering a quarter of it.) The card:
            Map | Satellite as a two-way choice with the one in use filled
            maroon, and Traffic as a switch that works on either — traffic was
            once a third "map type", which meant no traffic on satellite.
            Satellite is Google's "hybrid": imagery with street names on top. */}
        {Capacitor.isNativePlatform() && (() => {
          const TYPES = [
            { mode: 'default',   label: t('map.mapView') },
            { mode: 'satellite', label: t('map.satelliteView') },
          ]
          const maroon = 'var(--maroon)'
          return (
            <>
              {/* Tap anywhere else to close. Transparent, and only there while
                  open, so the map pans normally the rest of the time. */}
              {modeMenuOpen && (
                <div onClick={() => setModeMenuOpen(false)}
                  style={{ position: 'absolute', inset: 0, zIndex: 399 }} />
              )}
              <div style={{
                position: 'absolute', top: 8, right: 12, zIndex: 400,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
              }}>
                {modeMenuOpen && (
                  <div style={{
                    width: 196, background: '#FFF8F0',
                    border: '1.5px solid var(--maroon)', borderRadius: 14,
                    boxShadow: '0 4px 16px rgba(74,8,32,0.18)',
                    padding: 10, display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div role="radiogroup" aria-label={t('map.mapLayers')} style={{
                      display: 'flex', border: '1.5px solid var(--maroon)', borderRadius: 10, overflow: 'hidden',
                    }}>
                      {TYPES.map(o => {
                        const on = mapMode === o.mode
                        return (
                          <button
                            key={o.mode}
                            role="radio"
                            aria-checked={on}
                            onClick={() => setMapMode(o.mode)}
                            style={{
                              flex: 1, padding: '8px 4px', border: 'none',
                              background: on ? maroon : 'transparent',
                              color: on ? '#FFF8F0' : maroon,
                              fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      role="switch"
                      aria-checked={traffic}
                      onClick={() => setTraffic(v => !v)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        background: 'none', border: 'none', padding: '2px 2px',
                        color: maroon, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    >
                      {t('map.trafficView')}
                      {/* Same switch as the Profile toggles, a size smaller. */}
                      <span aria-hidden="true" style={{
                        width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: 'relative',
                        background: traffic ? maroon : 'var(--muted3)', transition: 'background 0.25s',
                      }}>
                        <span style={{
                          width: 16, height: 16, borderRadius: '50%', background: '#fff',
                          position: 'absolute', top: 3, left: traffic ? 19 : 3,
                          transition: 'left 0.25s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                        }} />
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* Timeline panel: whose day this is, Route | Times, and the time slider. */}
        {routeUid && route && (
          <TimelinePanel
            name={routeMember?.displayName || t('family.aFamilyMember')}
            route={route === 'loading' ? null : route}
            loading={route === 'loading'}
            range={timelineRange}
            onRange={changeTimelineRange}
            days={timelineDays}
            day={timelineDay}
            onDay={setTimelineDay}
            mode={timelineMode}
            onMode={setTimelineMode}
            time={timelineTime}
            onTime={setTimelineTime}
            onClose={hideRoute}
          />
        )}

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
              // A drawn X with a real edge. It was the letter "x" in pale grey on
              // a pale grey disc, which barely showed on the white paused chip.
              style={{
                background: followPaused ? '#F8E6ED' : 'rgba(255,255,255,0.22)',
                color: followPaused ? 'var(--maroon)' : '#fff',
                border: followPaused ? '1.5px solid var(--maroon)' : '1.5px solid rgba(255,255,255,0.6)',
                borderRadius: '50%', width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0, padding: 0,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
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
                          const eta = etaLabel(t, haversineKm(myLoc.lat, myLoc.lng, loc.lat, loc.lng))
                          return dist ? (
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--maroon)' }}>
                              ({dist}{eta ? ' · ' + eta : ''})
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
