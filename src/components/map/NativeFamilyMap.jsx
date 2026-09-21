import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { GoogleMap, MapType } from '@capacitor/google-maps'
import { GLIDE_MS } from '../SmoothMarker'
import { PIN_SIZE, initialPin, photoPin } from './pinIcon'
import { useT } from '../../i18n'

/**
 * The family map in the ANDROID app: Google's native map (Maps SDK for
 * Android), which Google does not charge to display. The browser keeps
 * LeafletFamilyMap; both take the same props from MapAllPage.
 *
 * How it is drawn
 * ───────────────
 * The native map sits BENEATH the whole WebView and shows through wherever the
 * page is transparent — which is why this component adds `native-map-open` to
 * <html> while mounted (see global.css): the body gradient and the cream app
 * shell would otherwise paint over it. Everything opaque on top — top bar,
 * bottom nav, compass, Find Fam, the Following chip, the member card — stays
 * ordinary HTML. Touches inside the map area are routed by the plugin: it asks
 * the page what is under the finger, so HTML on top of the map still gets
 * its taps.
 *
 * What the plugin could not do on its own (patched natively, see
 * patches/@capacitor+google-maps+8.0.1.patch): move a marker, take an app-drawn
 * image as its icon, pan over a set duration, and leave rotation, the Google
 * toolbar and tap-to-recentre out of it. The two marker calls have no JS
 * wrapper and go straight to the native plugin through Capacitor.Plugins.
 */

const MAP_ID = 'famora-family-map'
const DEFAULT_CENTER = { lat: 11.0168, lng: 76.9558 }

// Same rules as SmoothMarker, so a pin behaves identically on web and phone.
const IGNORE_BELOW_M = 10     // GPS noise: a stationary phone wanders this much
const SNAP_ABOVE_M   = 3000   // teleport rather than slide across the whole map

const native = () => Capacitor.Plugins.CapacitorGoogleMaps

// Map calls fail rather than wait while the native map is still being laid
// out — fitBounds in particular throws until the view has a size, and on a cold
// start the first data arrives before that. Framing is a one-shot, so a single
// failure left the camera parked on the default city for good. Retry briefly
// instead, and say so in the console rather than swallowing it.
async function retrying(label, fn, tries = 12, delayMs = 250) {
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      if (i === tries - 1) { console.warn(`[Map] ${label} failed:`, e?.message || e); return }
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}
const warn = label => e => console.warn(`[Map] ${label} failed:`, e?.message || e)

function distanceM(a, b) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Centre and zoom that fit every point inside a box of w×h CSS px (the same
// units as Google's dp zoom levels) with pad px spare on each side. Done here
// instead of through the plugin's fitBounds, which always ANIMATES: on opening
// the tab that swept the camera in from the default city every time, where the
// map should simply start framed on the family.
function frameFor(points, w, h, pad) {
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng)
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) }
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) }
  const center = { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 }
  const mercY = lat => {
    const s = Math.sin(lat * Math.PI / 180)
    return Math.log((1 + s) / (1 - s)) / 2
  }
  const latFrac = (mercY(ne.lat) - mercY(sw.lat)) / (2 * Math.PI)
  const lngFrac = (ne.lng - sw.lng) / 360
  const zoomFor = (px, frac) => frac > 0 ? Math.log2(Math.max(px - 2 * pad, 1) / 256 / frac) : Infinity
  // Capped at 17, the zoom a single member is flown to: members standing
  // together would otherwise zoom to street-furniture level.
  const zoom = Math.min(zoomFor(h, latFrac), zoomFor(w, lngFrac), 17)
  return { coordinate: center, zoom: Number.isFinite(zoom) ? zoom : 15 }
}

function inBounds(bounds, p) {
  if (!bounds?.southwest || !bounds?.northeast) return true   // unknown: assume visible
  const { southwest: sw, northeast: ne } = bounds
  return p.lat >= sw.lat && p.lat <= ne.lat && p.lng >= sw.lng && p.lng <= ne.lng
}

export default function NativeFamilyMap({
  pins, locations, flyTarget, followLoc, following, onUserPanned, renderPopup,
  // 'default' (road map), 'satellite' (imagery with street labels — Google's
  // "hybrid"), or 'traffic' (road map with Google's live traffic layer).
  mapMode = 'default',
  // Called with the map's rotation in degrees (0 = north up) while it turns.
  onBearingChange,
  // Bump to animate the map back to north-up (the compass's tap).
  resetNorthKey = 0,
}) {
  const t = useT()
  const elRef    = useRef(null)
  const mapRef   = useRef(null)
  const [ready, setReady] = useState(false)

  // uid → { idP: Promise<markerId>, lat, lng, look }. lat/lng is where the pin
  // is DRAWN — noise under IGNORE_BELOW_M is measured against it, so slow drift
  // still adds up to a glide eventually, exactly as SmoothMarker does.
  const markersRef   = useRef(new Map())
  const uidByIdRef   = useRef(new Map())   // markerId → uid, for taps
  const boundsRef    = useRef(null)        // visible area after the last camera move
  const onPannedRef  = useRef(onUserPanned)
  useEffect(() => { onPannedRef.current = onUserPanned }, [onUserPanned])

  const [openUid, setOpenUid] = useState(null)

  // Make the page see-through down to the map while it is on screen.
  useEffect(() => {
    document.documentElement.classList.add('native-map-open')
    return () => document.documentElement.classList.remove('native-map-open')
  }, [])

  // Create the map once; destroy it on the way out so it cannot linger under
  // other tabs (it is drawn beneath the whole WebView, not inside this div).
  useEffect(() => {
    let cancelled = false
    let map = null
    const markers = markersRef.current
    const uidById = uidByIdRef.current
    ;(async () => {
      try {
        map = await GoogleMap.create({
          id: MAP_ID,
          element: elRef.current,
          // Android reads the key from the manifest (MAPS_API_KEY in
          // local.properties); this argument is only used on web and iOS.
          apiKey: 'android-manifest',
          forceCreate: true,
          config: { center: DEFAULT_CENTER, zoom: 13 },
        })
        if (cancelled) { map.destroy(); return }
        mapRef.current = map

        await map.setOnMarkerClickListener(({ markerId }) => {
          const uid = uidByIdRef.current.get(markerId)
          if (uid) setOpenUid(uid)
        })
        await map.setOnMapClickListener(() => setOpenUid(null))
        // A finger on the map pauses following, like Leaflet's dragstart. The
        // app's own pans report isGesture false, so following never pauses itself.
        await map.setOnCameraMoveStartedListener(({ isGesture }) => {
          if (isGesture) onPannedRef.current?.()
        })
        await map.setOnBoundsChangedListener(({ bounds }) => { boundsRef.current = bounds })
        setReady(true)
      } catch (e) {
        console.warn('[Map] native map failed to start:', e?.message || e)
      }
    })()
    return () => {
      cancelled = true
      setReady(false)
      mapRef.current = null
      markers.clear()
      uidById.clear()
      map?.destroy().catch(() => {})
    }
  }, [])

  // ── Pins ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const live = markersRef.current

    for (const [uid, m] of live) {
      if (pins[uid]) continue
      live.delete(uid)
      m.idP.then(id => { uidByIdRef.current.delete(id); return map.removeMarker(id) }).catch(warn('remove pin'))
    }

    for (const [uid, loc] of Object.entries(pins)) {
      if (loc.lat == null || loc.lng == null) continue
      const initial = loc.displayName?.[0]?.toUpperCase() || '?'
      const look = `${loc.avatarUrl || ''}|${loc.avatarColor || ''}|${initial}`
      let m = live.get(uid)

      if (!m) {
        // The initial goes up at once; the photo, which has to download,
        // replaces it in place when (and if) it arrives.
        m = { lat: loc.lat, lng: loc.lng, look }
        m.idP = retrying('add pin', () => map.addMarker({
          coordinate: { lat: loc.lat, lng: loc.lng },
          iconUrl: initialPin(loc.avatarColor, initial),
          iconSize: { width: PIN_SIZE, height: PIN_SIZE },
          iconAnchor: { x: PIN_SIZE / 2, y: PIN_SIZE / 2 },
        })).then(id => {
          if (!id) throw new Error('pin was never added')
          uidByIdRef.current.set(id, uid)
          return id
        })
        live.set(uid, m)
        applyPhoto(m, loc.avatarUrl, look)
        continue
      }

      if (m.look !== look) {
        m.look = look
        m.idP.then(markerId => native().setMarkerIcon({
          id: MAP_ID, markerId, iconUrl: initialPin(loc.avatarColor, initial),
        })).catch(warn('pin icon'))
        applyPhoto(m, loc.avatarUrl, look)
      }

      const d = distanceM(m, loc)
      if (d < IGNORE_BELOW_M) continue
      m.lat = loc.lat
      m.lng = loc.lng
      const { lat, lng } = loc
      m.idP.then(markerId => native().animateMarker({
        id: MAP_ID, markerId, lat, lng, duration: d > SNAP_ABOVE_M ? 0 : GLIDE_MS,
      })).catch(warn('move pin'))
    }

    // Swap in the photo once it has loaded — unless the member's look changed
    // again meanwhile, in which case a newer call owns the icon.
    function applyPhoto(m, url, look) {
      if (!url) return
      photoPin(url).then(iconUrl => {
        if (!iconUrl || m.look !== look) return
        return m.idP.then(markerId => native().setMarkerIcon({ id: MAP_ID, markerId, iconUrl }))
      }).catch(warn('photo pin'))
    }
  }, [ready, pins])

  // ── Camera: frame everyone once, on first data ───────────────────────────
  const fittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || fittedRef.current) return
    const coords = Object.values(locations).filter(l => l.lat != null && l.lng != null)
    if (coords.length === 0) return
    fittedRef.current = true
    if (coords.length === 1) {
      retrying('frame member', () => map.setCamera({ coordinate: { lat: coords[0].lat, lng: coords[0].lng }, zoom: 15 }))
      return
    }
    const box = elRef.current?.getBoundingClientRect()
    const frame = frameFor(coords, box?.width || 360, box?.height || 560, 60)
    retrying('frame family', () => map.setCamera(frame))
  }, [ready, locations])

  // ── Camera: fly to a member picked in Find Fam ───────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !flyTarget) return
    retrying('fly to member', () => map.setCamera({
      coordinate: { lat: flyTarget.lat, lng: flyTarget.lng },
      zoom: 17, animate: true, animationDuration: 1000,
    }))
  }, [ready, flyTarget])

  // ── Camera: keep a followed member centred (logic as LeafletFamilyMap) ───
  const framedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!following) { framedRef.current = false; return }
    if (!ready || !map || !followLoc?.lat || !followLoc?.lng) return
    // The first fix after engaging belongs to the fly-to; following takes
    // over once they move. See FollowMember in LeafletFamilyMap.
    if (!framedRef.current) { framedRef.current = true; return }

    const coordinate = { lat: followLoc.lat, lng: followLoc.lng }
    if (!inBounds(boundsRef.current, coordinate)) {
      // Already off screen: an animated pan cannot catch up before the next
      // fix restarts it, so jump there and resume gliding from that point.
      map.setCamera({ coordinate, animate: false }).catch(warn('follow jump'))
      return
    }
    // Over exactly the pin's glide time (patched to be honoured on Android),
    // so map and pin arrive together instead of the pin trailing the centre.
    map.setCamera({ coordinate, animate: true, animationDuration: GLIDE_MS }).catch(warn('follow pan'))
  }, [ready, followLoc?.lat, followLoc?.lng, following])

  // A member who stopped sharing while their card was open simply has no card.
  const openLoc = openUid ? pins[openUid] : null

  // ── Member card rides on its pin ─────────────────────────────────────────
  // The card used to sit at the bottom of the map, away from the person it was
  // about. It now floats just above their pin and moves with it. A native pin
  // cannot host HTML, so the patched plugin's trackMarker reports the pin's
  // screen position every frame it moves — drags, camera pans and the pin's
  // own glide alike — and the card is placed from that. Positions are written
  // straight to the element rather than through React state: they arrive at
  // up to 60 a second and nothing else on the page depends on them.
  const cardRef  = useRef(null)
  const arrowRef = useRef(null)
  const lastPtRef = useRef(null)

  const placeCard = useCallback((x, y) => {
    lastPtRef.current = { x, y }
    const card = cardRef.current
    const box  = elRef.current
    if (!card || !box) return
    const w = card.offsetWidth, h = card.offsetHeight, W = box.clientWidth
    const gap = PIN_SIZE / 2 + 12          // clear of the round pin, room for the pointer
    let top = y - gap - h
    const below = top < 8                  // no room above: open underneath instead
    if (below) top = y + gap
    const left = Math.min(Math.max(x - w / 2, 8), Math.max(W - w - 8, 8))
    card.style.transform = `translate(${left}px, ${top}px)`
    card.style.visibility = 'visible'
    const arrow = arrowRef.current
    if (arrow) {
      // The pointer stays on the pin even when the card is pushed off-centre
      // by a screen edge.
      arrow.style.left = `${Math.min(Math.max(x - left, 18), w - 18)}px`
      arrow.style.top = below ? '-7px' : ''
      arrow.style.bottom = below ? '' : '-7px'
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const handleP = native().addListener('onTrackedMarkerMove', ({ x, y }) => placeCard(x, y))
    return () => { handleP.then(h => h.remove()).catch(() => {}) }
  }, [ready, placeCard])

  // ── Map type and rotation ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    retrying('map type', () => map.setMapType(mapMode === 'satellite' ? MapType.Hybrid : MapType.Normal))
    retrying('traffic layer', () => map.enableTrafficLayer(mapMode === 'traffic'))
  }, [ready, mapMode])

  // Two-finger rotation is on (patched); the plugin streams the bearing while
  // it changes so the compass overlay turns with the map, not after it.
  const onBearingRef = useRef(onBearingChange)
  useEffect(() => { onBearingRef.current = onBearingChange }, [onBearingChange])
  useEffect(() => {
    if (!ready) return
    const handleP = native().addListener('onBearingChange', ({ bearing }) => onBearingRef.current?.(bearing))
    return () => { handleP.then(h => h.remove()).catch(() => {}) }
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !resetNorthKey) return
    // Only the bearing is given, so the plugin keeps the centre and zoom.
    map.setCamera({ bearing: 0, animate: true, animationDuration: 350 }).catch(warn('reset north'))
  }, [ready, resetNorthKey])

  useEffect(() => {
    if (!ready || !openUid) return
    const m = markersRef.current.get(openUid)
    if (!m) return
    // Hidden until the first position lands, so it never flashes at 0,0.
    lastPtRef.current = null
    if (cardRef.current) cardRef.current.style.visibility = 'hidden'
    m.idP.then(markerId => native().trackMarker({ id: MAP_ID, markerId })).catch(warn('track pin'))
    return () => { native().trackMarker({ id: MAP_ID, markerId: null }).catch(() => {}) }
  }, [ready, openUid])

  // The card's own size can change without the pin moving (a photo loading,
  // the distance line updating): re-place it from the last known point.
  useEffect(() => {
    const card = cardRef.current
    if (!card || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const p = lastPtRef.current
      if (p) placeCard(p.x, p.y)
    })
    ro.observe(card)
    return () => ro.disconnect()
  }, [openUid, placeCard])

  return (
    <>
      {/* The plugin positions the native map to this element's box and keeps
          it there as the layout changes (it watches its size). */}
      <capacitor-google-map
        ref={elRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* Member card — what the Leaflet popup shows, held over the member's
          pin by placeCard() above. Sized to its content, not stretched. */}
      {openLoc && (
        <div ref={cardRef} style={{
          position: 'absolute', left: 0, top: 0, visibility: 'hidden',
          willChange: 'transform',
          width: 'max-content', maxWidth: 'calc(100% - 16px)',
          zIndex: 1000,
          background: '#fff', borderRadius: 14,
          border: '1px solid var(--border)',
          boxShadow: '0 8px 28px rgba(74,8,32,0.22)',
          padding: '10px 40px 10px 12px',
        }}>
          {/* Pointer to the pin: a rotated square sharing the card's border. */}
          <div ref={arrowRef} style={{
            position: 'absolute', bottom: -7, left: '50%',
            width: 12, height: 12, marginLeft: -6,
            background: '#fff', transform: 'rotate(45deg)',
            borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            borderTop: '1px solid transparent', borderLeft: '1px solid transparent',
          }} />
          {renderPopup(openUid, openLoc)}
          <button
            onClick={() => setOpenUid(null)}
            aria-label={t('common.close')}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: 'var(--surface3)', color: 'var(--text2)',
              fontSize: 14, lineHeight: '26px', padding: 0,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>x</button>
        </div>
      )}
    </>
  )
}
