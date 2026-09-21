import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
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

export default function LeafletFamilyMap({
  pins, locations, flyTarget, followLoc, following, onUserPanned, renderPopup,
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

      {Object.entries(pins).map(([uid, loc]) => (
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
      ))}
    </MapContainer>
  )
}
