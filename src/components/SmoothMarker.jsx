import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * A Leaflet marker that animates (slides) to each new position instead of
 * teleporting. react-leaflet's <Marker position> prop snaps instantly, which
 * is what makes pins "jump" while someone is driving. This component controls
 * the underlying Leaflet marker imperatively and interpolates between the old
 * and new coordinates with requestAnimationFrame.
 *
 * Props:
 *   position  [lat, lng] — the target position
 *   icon      L.divIcon  — the marker icon
 *   duration  ms         — how long each glide takes (default 2000)
 *   snapAbove meters     — jumps larger than this snap instantly instead of
 *                          sliding across the whole map (default 3000)
 *   children             — React content rendered inside the popup
 */
export default function SmoothMarker({
  position, icon, duration = 2000, snapAbove = 3000, children,
}) {
  const map = useMap()
  const markerRef    = useRef(null)
  const rafRef       = useRef(null)
  const fromRef      = useRef(position)
  const popupRootRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Create the marker once
  useEffect(() => {
    const marker = L.marker(position, { icon })
    marker.addTo(map)
    markerRef.current = marker
    fromRef.current = position

    // Container the React popup content will portal into
    const container = L.DomUtil.create('div')
    popupRootRef.current = container
    marker.bindPopup(container, { closeButton: true, offset: [0, -18] })

    setReady(true)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      map.removeLayer(marker)
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep icon in sync (avatar may load after mount)
  useEffect(() => {
    if (markerRef.current) markerRef.current.setIcon(icon)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icon])

  // Animate when the target position changes
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return

    const from = fromRef.current
    const to   = position
    if (from && to && from[0] === to[0] && from[1] === to[1]) return

    const distanceMeters = from ? map.distance(L.latLng(from), L.latLng(to)) : Infinity

    // Snap instantly for very large jumps (teleport rather than slide across map)
    if (!from || distanceMeters > snapAbove) {
      marker.setLatLng(to)
      fromRef.current = to
      return
    }

    // Ignore tiny movements — pure GPS noise under 10m.
    // Without this, a stationary user's pin drifts constantly.
    if (distanceMeters < 10) return

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const start = performance.now()
    const [lat0, lng0] = from
    const [lat1, lng1] = to

    const step = (now) => {
      const t = Math.min((now - start) / duration, 1)
      const e = easeInOutQuad(t)
      marker.setLatLng([lat0 + (lat1 - lat0) * e, lng0 + (lng1 - lng0) * e])
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(step)

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1]])

  return ready && popupRootRef.current && children
    ? createPortal(children, popupRootRef.current)
    : null
}
