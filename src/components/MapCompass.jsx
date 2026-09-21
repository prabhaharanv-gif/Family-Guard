import { useRef } from 'react'
import { useDeviceHeading, cardinalOf } from '../hooks/useDeviceHeading'
import { useT } from '../i18n'

/**
 * MapCompass — map orientation, plus which way the phone is pointing.
 *
 * Two separate things share one badge, and keeping them apart is the point:
 *
 *   The ring and its N/E/S/W letters describe the MAP. On the phone the map can
 *   be turned with two fingers (Google's native map, rotation on since
 *   2026-09-21), so the ring turns with it: N always points at the map's north.
 *   While the map is turned the badge is a button that swings it back to
 *   north-up. The browser's Leaflet map has no rotation, so there `bearing`
 *   stays 0 and the ring never moves.
 *
 *   The needle turns with the phone's magnetometer, so it answers "which way
 *   am I facing" while you walk toward someone. It is drawn as an arrow rather
 *   than a north-pointer to keep the two readings from being confused. On a
 *   turned map it is drawn at heading minus bearing, so it still points the
 *   way the phone faces ON the map.
 *
 * With no usable heading — a phone with no magnetometer, a browser that never
 * fires an absolute reading, iOS without its permission gesture — the needle is
 * replaced by a plain north marker that turns with the ring. Nothing on screen
 * then claims to know a direction it does not have. See useDeviceHeading for
 * why a relative reading is refused rather than shown.
 *
 * Placed below Leaflet's zoom control (top-left, roughly y=10..70) rather than
 * top-right, where the Find Fam panel on MapAllPage opens, or bottom, where the
 * follow chip and the OSM attribution already sit.
 *
 * pointerEvents: 'none' while north is up — the map still pans and pinches
 * underneath it. Without it this becomes a dead 46px patch that swallows every
 * drag starting there. Only a turned map makes it tappable.
 */
export default function MapCompass({ bearing = 0, onResetNorth }) {
  const t = useT()
  const { angle, heading } = useDeviceHeading()
  const live = angle != null

  // Unwrap the bearing the same way useDeviceHeading unwraps the heading, so a
  // turn through north animates the short way instead of spinning backwards
  // round the whole dial when 359° becomes 0°.
  const unwrapped = useRef({ last: 0, total: 0 })
  {
    const u = unwrapped.current
    let d = bearing - u.last
    if (d > 180) d -= 360
    if (d < -180) d += 360
    u.total += d
    u.last = bearing
  }
  const mapAngle = unwrapped.current.total
  const b360 = ((bearing % 360) + 360) % 360
  const rotated = b360 > 0.5 && b360 < 359.5
  const tappable = rotated && !!onResetNorth

  return (
    <div
      onClick={tappable ? onResetNorth : undefined}
      style={{
        position: 'absolute', top: 82, left: 12, zIndex: 400,
        width: 46, height: 46, borderRadius: '50%',
        background: 'rgba(255,255,255,0.94)',
        border: `1.5px solid ${tappable ? 'var(--maroon)' : 'var(--border)'}`,
        boxShadow: '0 2px 10px rgba(74,8,32,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: tappable ? 'auto' : 'none',
        cursor: tappable ? 'pointer' : 'default',
      }}
      // The whole badge is one image (or button) to a screen reader. Without
      // this the letters are read out as the bare string "N E S W".
      role={tappable ? 'button' : 'img'}
      aria-label={tappable
        ? t('map.resetNorth')
        : live
          ? `Map orientation: north is up. You are facing ${cardinalOf(heading)}.`
          : 'Map orientation: north is up'}
    >
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        {live && (
          <g
            // Screen angle = phone heading minus map rotation. Both are
            // unwrapped, so this never unwinds backwards when either passes
            // north.
            transform={`rotate(${angle - mapAngle} 23 23)`}
            // Matches the hook's ~10/s emit rate closely enough to read as
            // continuous without lagging behind a deliberate turn.
            style={{ transition: 'transform 110ms linear' }}
          >
            {/* Facing arrow — the only filled maroon shape, so which end leads
                is unmistakable at a glance. */}
            <path d="M23 10.5 L28 24 L23 21.2 L18 24 Z" fill="var(--maroon)" />
            {/* Tail, lighter, to give the arrow an axis without competing. */}
            <path d="M23 34.5 L20.6 26.5 L23 27.8 L25.4 26.5 Z" fill="#D9C3CC" />
          </g>
        )}

        {/* The map's own orientation: letters (and, with no heading, the north
            marker) turn with the map. No transition — the bearing already
            arrives every frame while the map turns. 9px is above the 8px floor
            Android WebView clamps text to. */}
        <g transform={`rotate(${-mapAngle} 23 23)`}>
          {!live && (
            <>
              <path d="M23 11 L27.4 23 L23 20.4 L18.6 23 Z" fill="var(--maroon)" />
              <path d="M23 35 L18.6 23 L23 25.6 L27.4 23 Z" fill="#D9C3CC" />
            </>
          )}
          <text x="23" y="8.5"  textAnchor="middle" fontSize="9" fontWeight="800"
                fill="var(--maroon)" fontFamily="Inter, sans-serif">N</text>
          <text x="23" y="44"   textAnchor="middle" fontSize="9" fontWeight="700"
                fill="var(--muted)" fontFamily="Inter, sans-serif">S</text>
          <text x="41.5" y="26" textAnchor="middle" fontSize="9" fontWeight="700"
                fill="var(--muted)" fontFamily="Inter, sans-serif">E</text>
          <text x="4.5" y="26"  textAnchor="middle" fontSize="9" fontWeight="700"
                fill="var(--muted)" fontFamily="Inter, sans-serif">W</text>
        </g>
      </svg>
    </div>
  )
}
