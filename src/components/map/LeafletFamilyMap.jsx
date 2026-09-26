import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { DEST_PIN, destPin, timeCallout, stayDot, startDot, endDot, STAY_DOT, END_DOT, anonDot, ANON_DOT, helperDot, HELPER_DOT } from './pinIcon'
import SmoothMarker, { GLIDE_MS } from '../SmoothMarker'

/**
 * The family map on the WEB (browser / dev preview). The Android app uses
 * NativeFamilyMap — Google's native map, which is free to display — and this
 * Leaflet + OpenStreetMap version stays for the browser so the web build never
 * touches the billed Google Maps JavaScript API.
 *
 * Both take the same props; MapAllPage owns every decision (who to follow,
 * where to fly, which pins overlap) and these only draw it. The components
 * below were moved here unchanged from MapAllPage.
 */

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Every avatar wears a maroon ring outside its white edge (same as the phone's
// pins, pinIcon.js). ring = null draws the plain white-edged pin.
function createIcon(color, initial, avatarUrl, ring = 'var(--maroon)') {
  const shadow = ring ? `0 0 0 3px ${ring},0 2px 12px rgba(0,0,0,0.25)` : '0 2px 12px rgba(0,0,0,0.25)'
  const content = avatarUrl
    ? `<img src="${avatarUrl}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:${shadow};" />`
    : `<div style="
        width:44px;height:44px;border-radius:50%;
        background:${color};border:3px solid #fff;
        display:flex;align-items:center;justify-content:center;
        font-weight:800;font-size:18px;color:#fff;
        box-shadow:${shadow};
        font-family:Inter,sans-serif;
      ">${initial}</div>`
  return L.divIcon({
    className: '',
    html: content,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

// Flies the map to a specific member when flyTarget changes
function FlyToMember({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 17, { animate: true, duration: 1.0 })
  }, [target])
  return null
}

/**
 * Keeps a chosen member on screen while they move.
 *
 * FlyToMember above is a one-shot: it takes the coordinates the member had at
 * the moment they were tapped and flies there. That is right for finding
 * someone and wrong for watching them — a member in a car leaves the viewport
 * within a minute and has to be chased by hand.
 *
 * This pans instead, and only once they approach an edge. Re-centring on every
 * fix would fight the user: a phone standing still wanders a few metres and the
 * map would twitch continuously. panTo also keeps whatever zoom was chosen,
 * where flyTo would snap it back.
 */
function FollowMember({ loc, following, onUserPanned }) {
  const map = useMap()
  // Whether following has already framed this member. Following engages in the
  // same instant FlyToMember starts its zoom, and without this the recovery
  // branch below fired immediately — the member is off screen at the map's
  // resting zoom — and hard-set the view at the OLD zoom, cancelling the fly.
  // Tapping a row then jumped to them without zooming in at all.
  //
  // So the first run after engaging is skipped: framing belongs to
  // FlyToMember, and following only takes over once they actually move.
  const framedRef = useRef(false)

  // Dragging pauses rather than cancels, and the chip above the map says so —
  // the first version cancelled silently on any drag, which on a touch map is
  // constant, so following appeared never to work at all.
  //
  // Leaflet's own panTo and flyTo fire movestart, not dragstart, so the map
  // following a member cannot pause itself.
  useEffect(() => {
    const pause = () => onUserPanned()
    map.on('dragstart', pause)
    return () => { map.off('dragstart', pause) }
  }, [map, onUserPanned])

  // Keeps them centred rather than nudging only once they near an edge. Edge
  // nudging was the first attempt and it reads as broken: the marker drifts
  // most of the way across the screen before anything happens, and at high zoom
  // it can leave the viewport between two fixes and never come back.
  //
  // Centring is safe here precisely because positions are not continuous: the
  // service only pushes after 15m of movement or a 90s heartbeat, so there is
  // no GPS jitter to chase and the map moves in the same deliberate steps the
  // marker does.
  useEffect(() => {
    if (!following) { framedRef.current = false; return }
    if (!loc?.lat || !loc?.lng) return
    if (!framedRef.current) { framedRef.current = true; return }

    // If the marker is already off screen the animation cannot rescue it —
    // panning takes GLIDE_MS, by which time another fix has usually arrived and
    // restarted the whole thing. Jump straight there instead, then resume
    // gliding. This is the safety net for a corner taken at speed, where the
    // marker can leave the viewport between two fixes.
    const p    = map.latLngToContainerPoint([loc.lat, loc.lng])
    const size = map.getSize()
    const offScreen = p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y
    if (offScreen) {
      map.setView([loc.lat, loc.lng], map.getZoom(), { animate: false })
      return
    }

    // Matched to the marker's own glide so the two move as one. Any shorter and
    // the map arrives first, leaving the marker trailing the centre by the
    // difference — which at speed is tens of metres, and off screen when
    // zoomed in.
    map.panTo([loc.lat, loc.lng], { animate: true, duration: GLIDE_MS / 1000 })
  }, [loc?.lat, loc?.lng, following, map])

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

// The Timeline: one solid maroon line per stretch with no gap, framed once
// each time a route is opened, above the panel covering the foot of the map.
// The dots and Start/Now boxes are the same bitmaps the phone draws, so both
// maps show one design; a tap on any of them opens directions to that spot.
const DOT = { stay: [stayDot, STAY_DOT, 200], start: [startDot, STAY_DOT, 300], end: [endDot, END_DOT, 300] }

function RouteLine({ route, inset, renderSpotPopup }) {
  const map = useMap()
  useEffect(() => {
    if (route && route.path.length >= 2) {
      map.fitBounds(route.path.map(p => [p.lat, p.lng]), {
        paddingTopLeft: [50, 50], paddingBottomRight: [50, 50 + inset], maxZoom: 17,
      })
    }
    // inset is a constant from the page; framing happens per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route])
  if (!route || route.path.length < 2) return null
  const ll = p => [p.lat, p.lng]
  const popup = spot => renderSpotPopup && <Popup>{renderSpotPopup(spot)}</Popup>
  return (
    <>
      {route.segments.filter(seg => seg.length >= 2).map((seg, i) => (
        <Polyline key={'r' + i} positions={seg.map(ll)}
          pathOptions={{ color: '#8B0D3D', weight: 5, opacity: 0.9 }} />
      ))}
      {(route.callouts || []).map((c, i) => {
        const box = timeCallout(c.labels, c.dir)
        return (
          <Marker key={'c' + i} position={ll(c)} zIndexOffset={100}
            icon={L.icon({ iconUrl: box.url, iconSize: [box.width, box.height], iconAnchor: [box.anchorX, box.anchorY] })}>
            {popup(c)}
          </Marker>
        )
      })}
      {(route.spots || []).map((sp, i) => {
        const [icon, size, z] = DOT[sp.kind]
        return (
          <Marker key={'d' + i} position={ll(sp)} zIndexOffset={z}
            icon={L.icon({ iconUrl: icon(), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })}>
            {popup(sp)}
          </Marker>
        )
      })}
    </>
  )
}

// Times mode: the member's avatar where they were at the picked time. It
// jumps with the slider (no glide): the finger is already the animation.
function RouteCursor({ cursor, renderSpotPopup }) {
  const initial = cursor?.displayName?.[0]?.toUpperCase() || '?'
  const icon = useMemo(
    () => cursor && createIcon(cursor.avatarColor || 'var(--maroon)', initial, cursor.avatarUrl || null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!cursor, cursor?.avatarColor, cursor?.avatarUrl, initial],
  )
  if (!cursor) return null
  return (
    <Marker position={[cursor.lat, cursor.lng]} icon={icon} zIndexOffset={1000}>
      {renderSpotPopup && <Popup>{renderSpotPopup(cursor)}</Popup>}
    </Marker>
  )
}

// A held finger (Leaflet turns a touch long-press into contextmenu) or a right
// click on the map: the spot to measure the followed member's trip to.
function LongPress({ onLongPress }) {
  useMapEvents({ contextmenu: e => onLongPress?.({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

export default function LeafletFamilyMap({
  pins, locations, flyTarget, followLoc, following, onUserPanned, renderPopup, renderSpotPopup,
  route = null, routeCursor = null, routeInset = 0, onLongPress, destination = null,
}) {
  return (
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
      <FollowMember loc={followLoc} following={following} onUserPanned={onUserPanned} />
      <RouteLine route={route} inset={routeInset} renderSpotPopup={renderSpotPopup} />
      <RouteCursor cursor={routeCursor} renderSpotPopup={renderSpotPopup} />
      <LongPress onLongPress={onLongPress} />
      {destination && (
        <Marker
          position={[destination.lat, destination.lng]}
          icon={L.icon({ iconUrl: destPin(), iconSize: [DEST_PIN, DEST_PIN], iconAnchor: [DEST_PIN / 2, DEST_PIN / 2] })}
          interactive={false}
        />
      )}

      {Object.entries(pins).map(([uid, loc]) => (
        loc.kind === 'anonDot' ? (
          // Famora Social's ambient dots (see NearbySearchMap): no avatar,
          // no popup, and `interactive={false}` so Leaflet gives them no
          // click handler or hover cursor at all — untappable by construction,
          // not by leaving renderPopup empty. A plain Marker rather than
          // SmoothMarker: these carry no identity to glide between fetches,
          // and each fetch hands back freshly fuzzed points under new keys,
          // so gliding one to the next would itself be a small location leak.
          <Marker
            key={uid}
            position={[loc.lat, loc.lng]}
            icon={L.icon({ iconUrl: anonDot(), iconSize: [ANON_DOT, ANON_DOT], iconAnchor: [ANON_DOT / 2, ANON_DOT / 2] })}
            interactive={false}
          />
        ) : loc.kind === 'helperFound' ? (
          // The accepted helper's fuzzy area (see NearbySearchMap) — same
          // untappable, no-popup, no-identity treatment as the ambient dots
          // above, but green and with a small pulsing ring (helper-found-ring
          // in global.css) so it reads as "found" without a native-pin-style
          // bitmap having to animate.
          <Marker
            key={uid}
            position={[loc.lat, loc.lng]}
            icon={L.divIcon({
              className: '',
              html: `<div class="helper-found-marker"><span class="helper-found-ring"></span><img src="${helperDot()}" width="${HELPER_DOT}" height="${HELPER_DOT}" /></div>`,
              iconSize: [HELPER_DOT, HELPER_DOT],
              iconAnchor: [HELPER_DOT / 2, HELPER_DOT / 2],
            })}
            interactive={false}
          />
        ) : (
          <SmoothMarker
            key={uid}
            position={[loc.lat, loc.lng]}
            icon={createIcon(
              loc.avatarColor || 'var(--maroon)',
              loc.displayName?.[0]?.toUpperCase() || '?',
              loc.avatarUrl || null
            )}
          >
            {renderPopup(uid, loc)}
          </SmoothMarker>
        )
      ))}
    </MapContainer>
  )
}
