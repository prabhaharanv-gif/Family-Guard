import { useDeviceHeading, cardinalOf } from '../hooks/useDeviceHeading'

/**
 * MapCompass — map orientation, plus which way the phone is pointing.
 *
 * Two separate things share one badge, and keeping them apart is the point:
 *
 *   The ring and its N/E/S/W letters never move. Leaflet has no map rotation,
 *   so north is always up on both map screens; the letters describe the map.
 *
 *   The needle turns with the phone's magnetometer, so it answers "which way
 *   am I facing" while you walk toward someone. It is drawn as an arrow rather
 *   than a north-pointer to keep the two readings from being confused.
 *
 * With no usable heading — a phone with no magnetometer, a browser that never
 * fires an absolute reading, iOS without its permission gesture — the needle is
 * replaced by a plain fixed north marker. Nothing on screen then claims to know
 * a direction it does not have. See useDeviceHeading for why a relative reading
 * is refused rather than shown.
 *
 * Placed below Leaflet's zoom control (top-left, roughly y=10..70) rather than
 * top-right, where the Find Fam panel on MapAllPage opens, or bottom, where the
 * follow chip and the OSM attribution already sit.
 *
 * pointerEvents: 'none' — the map still pans and pinches underneath it. Without
 * it this becomes a dead 46px patch that swallows every drag starting there.
 */
export default function MapCompass() {
  const { angle, heading } = useDeviceHeading()
  const live = angle != null

  return (
    <div
      style={{
        position: 'absolute', top: 82, left: 12, zIndex: 400,
        width: 46, height: 46, borderRadius: '50%',
        background: 'rgba(255,255,255,0.94)',
        border: '1.5px solid #ECE0E5',
        boxShadow: '0 2px 10px rgba(74,8,32,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}
      // The whole badge is one image to a screen reader. Without this the
      // letters are read out as the bare string "N E S W".
      role="img"
      aria-label={live
        ? `Map orientation: north is up. You are facing ${cardinalOf(heading)}.`
        : 'Map orientation: north is up'}
    >
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        {live ? (
          <g
            // Rotated clockwise from up by the heading, because the map itself
            // is north-up: screen-up IS north, so the heading in degrees is
            // already the on-screen angle. `angle` is the unwrapped value, so
            // this never unwinds backwards when the phone passes north.
            transform={`rotate(${angle} 23 23)`}
            // Matches the hook's ~10/s emit rate closely enough to read as
            // continuous without lagging behind a deliberate turn.
            style={{ transition: 'transform 110ms linear' }}
          >
            {/* Facing arrow — the only filled maroon shape, so which end leads
                is unmistakable at a glance. */}
            <path d="M23 10.5 L28 24 L23 21.2 L18 24 Z" fill="#8B0D3D" />
            {/* Tail, lighter, to give the arrow an axis without competing. */}
            <path d="M23 34.5 L20.6 26.5 L23 27.8 L25.4 26.5 Z" fill="#D9C3CC" />
          </g>
        ) : (
          <>
            {/* No heading available: a fixed north marker, making no claim
                about which way the phone is pointing. */}
            <path d="M23 11 L27.4 23 L23 20.4 L18.6 23 Z" fill="#8B0D3D" />
            <path d="M23 35 L18.6 23 L23 25.6 L27.4 23 Z" fill="#D9C3CC" />
          </>
        )}

        {/* Cardinal letters — fixed, because the map is. 9px is above the 8px
            floor Android WebView clamps text to, so these stay the size they
            are set to on the phone. */}
        <text x="23" y="8.5"  textAnchor="middle" fontSize="9" fontWeight="800"
              fill="#8B0D3D" fontFamily="Inter, sans-serif">N</text>
        <text x="23" y="44"   textAnchor="middle" fontSize="9" fontWeight="700"
              fill="#7D5A67" fontFamily="Inter, sans-serif">S</text>
        <text x="41.5" y="26" textAnchor="middle" fontSize="9" fontWeight="700"
              fill="#7D5A67" fontFamily="Inter, sans-serif">E</text>
        <text x="4.5" y="26"  textAnchor="middle" fontSize="9" fontWeight="700"
              fill="#7D5A67" fontFamily="Inter, sans-serif">W</text>
      </svg>
    </div>
  )
}
