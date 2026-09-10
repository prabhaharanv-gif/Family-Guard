import { useEffect, useRef, useState } from 'react'

/**
 * useDeviceHeading — which way the phone is physically pointing, in degrees
 * clockwise from true/magnetic north. Returns null whenever that cannot be
 * answered honestly, and the caller is expected to show nothing rather than
 * a needle at zero.
 *
 * Returns { angle, heading }:
 *   angle    unwrapped and continuous, for a CSS rotate(). It keeps counting
 *            past 360 and below 0 on purpose — see the wrap note below.
 *   heading  the same value normalised to 0..359, for reading out a direction.
 *
 * ── Only ABSOLUTE orientation is a compass ──────────────────────────────────
 * `deviceorientation` fires on nearly every phone, but on many of them its
 * alpha is *relative*: zero is wherever the device happened to be when the
 * sensor started, and it drifts. Rendering that as a compass produces a needle
 * that looks authoritative and points at nothing in particular, which is worse
 * than no needle — someone walking toward a family member would follow it.
 * So a reading is accepted only from `deviceorientationabsolute`, or from a
 * `deviceorientation` event that either sets `absolute === true` or carries
 * iOS's `webkitCompassHeading`.
 *
 * On iOS 13+ the sensor is gated behind DeviceOrientationEvent.requestPermission(),
 * which must be called from a user gesture. There is no iOS build of this app,
 * and prompting for a gesture just to spin a needle is not worth it, so on iOS
 * Safari no events arrive, this stays null, and the compass stays fixed.
 */

// Low-pass factor. The magnetometer is noisy enough that a raw feed makes the
// needle jitter a few degrees while the phone sits still on a table; 0.25 damps
// that without visible lag when the phone is actually turned.
const SMOOTHING = 0.25

// Don't re-render for movement below this, or for more often than this. The
// needle is 46px across, where a degree is invisible.
const MIN_DELTA_DEG = 0.8
const MIN_INTERVAL_MS = 100

/** Shortest signed way round the circle from a to b, in (-180, 180]. */
function shortestDelta(a, b) {
  return ((b - a + 540) % 360) - 180
}

function readHeading(e, eventIsAbsolute) {
  // iOS reports the compass directly, already clockwise from north.
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    return e.webkitCompassHeading
  }
  if (!(eventIsAbsolute || e.absolute === true)) return null
  if (typeof e.alpha !== 'number' || Number.isNaN(e.alpha)) return null

  // alpha is measured anticlockwise from north; a compass heading runs
  // clockwise, hence 360 - alpha.
  //
  // The screen-angle term matters only in a browser that rotates to landscape:
  // it re-references the reading from the device's top edge to the top of what
  // is actually on screen. Both Android activities are locked to portrait, so
  // this is always 0 there, and it is untested in landscape.
  const screenAngle = (typeof screen !== 'undefined' && screen.orientation)
    ? (screen.orientation.angle || 0)
    : (typeof window !== 'undefined' && typeof window.orientation === 'number' ? window.orientation : 0)

  return (360 - e.alpha + screenAngle + 360) % 360
}

export function useDeviceHeading() {
  const [state, setState] = useState({ angle: null, heading: null })

  // Continuous angle, kept in a ref so the smoothing survives re-renders.
  const angleRef = useRef(null)
  const lastEmit = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.DeviceOrientationEvent) return

    let disposed = false

    const apply = (raw) => {
      if (disposed || raw == null) return

      if (angleRef.current == null) {
        angleRef.current = raw
      } else {
        // Accumulate the shortest step rather than jumping to the new value.
        // This is what keeps the angle continuous across the 359 -> 0 seam:
        // a needle driven by the wrapped value would unwind the long way round
        // — a full backwards spin — every time the phone crossed north.
        angleRef.current += shortestDelta(((angleRef.current % 360) + 360) % 360, raw) * SMOOTHING
      }

      const now = Date.now()
      if (now - lastEmit.current < MIN_INTERVAL_MS) return

      const angle = angleRef.current
      const heading = ((angle % 360) + 360) % 360
      setState(prev => {
        if (prev.angle != null && Math.abs(angle - prev.angle) < MIN_DELTA_DEG) return prev
        lastEmit.current = now
        return { angle, heading }
      })
    }

    const onAbsolute = (e) => apply(readHeading(e, true))
    const onPlain    = (e) => apply(readHeading(e, false))

    // Re-attaching rather than attaching once: where a permission grant arrives
    // after the fact, listeners registered before it are not guaranteed to start
    // receiving anything, so the grant path calls this again to be sure.
    const attach = () => {
      if (disposed) return
      window.removeEventListener('deviceorientationabsolute', onAbsolute, true)
      window.removeEventListener('deviceorientation', onPlain, true)
      window.addEventListener('deviceorientationabsolute', onAbsolute, true)
      window.addEventListener('deviceorientation', onPlain, true)
    }

    // Android's WebView delivers orientation without being asked, so listen
    // immediately — waiting for a gesture would leave the needle dead for
    // anyone who only looks at the map without touching it.
    attach()

    // ...but DeviceOrientationEvent.requestPermission exists on iOS Safari, and
    // this Redmi's WebView exposes it too. Where an engine actually enforces it,
    // nothing is delivered until it has been granted, and it may only be called
    // from a user gesture — so ask on the first touch and re-attach if granted.
    // On an engine that does not enforce it the call is harmless: it resolves
    // 'granted' straight away, which is what this device does.
    const request = window.DeviceOrientationEvent.requestPermission
    let askOnGesture = null
    if (typeof request === 'function') {
      askOnGesture = async () => {
        try {
          const result = await request.call(window.DeviceOrientationEvent)
          if (result === 'granted') attach()
        } catch { /* denied, or called without a real gesture */ }
      }
      window.addEventListener('pointerdown', askOnGesture, { once: true, passive: true })
    }

    return () => {
      disposed = true
      window.removeEventListener('deviceorientationabsolute', onAbsolute, true)
      window.removeEventListener('deviceorientation', onPlain, true)
      if (askOnGesture) window.removeEventListener('pointerdown', askOnGesture)
    }
  }, [])

  return state
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** Nearest of the eight compass points, for a spoken/aria description. */
export function cardinalOf(heading) {
  if (heading == null) return null
  return POINTS[Math.round(heading / 45) % 8]
}
