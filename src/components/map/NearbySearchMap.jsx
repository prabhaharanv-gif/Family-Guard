import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../../lib/supabase'
import LeafletFamilyMap from './LeafletFamilyMap'
import NativeFamilyMap from './NativeFamilyMap'

// Same dual-renderer switch as MapAllPage / the old FamoraSocialPage: Google's
// native map (free to display) in the Android app, Leaflet + OpenStreetMap in
// the browser.
const FamilyMap = Capacitor.isNativePlatform() ? NativeFamilyMap : LeafletFamilyMap

// Same radius useNearbyUsers uses for list_famora_social_dots.
const DOTS_RADIUS_M = 15000
// Refresh the ambient dots periodically while this stays on screen — same
// cadence useNearbyUsers polls at — so a helper watching the sent/overlay
// screen for a while still sees a roughly current picture, not the one fetch
// taken the moment the map mounted.
const DOTS_POLL_MS = 30_000

const noop = () => {}

/**
 * NearbySearchMap
 *
 * The "is anyone nearby helping?" map, shared by SOSPage's own sent screen
 * (the sender watching their own SOS) and GlobalSOSAlert (every other family
 * member's full-screen overlay), so the two never drift into two separate
 * implementations of the same read-only view.
 *
 * Shows, centred on the sender's own alert position:
 *  - every opted-in Famora Social dot nearby (list_famora_social_dots,
 *    centred on the SENDER's location — every viewer of this map sees the
 *    same dots, not dots centred on wherever they themselves are standing);
 *  - a radar-ripple overlay while `status` is 'searching';
 *  - the accepted helper's fuzzy area, once `status` is 'helper_found'
 *    (get_accepted_helper_area) — a small green dot, distinct from both the
 *    family maroon and the SOS red.
 *
 * Never tappable, never shows identity, no navigation/directions — the same
 * safety boundary the old FamoraSocialPage's ambient map already kept.
 *
 * @param lat, lng      the sent SOS alert's own coordinates
 * @param status        the escalation's status: 'searching' | 'helper_found'
 *                       | 'exhausted' | 'resolved' | null
 * @param escalationId  nearby_help_escalations.id — needed only once status
 *                       is 'helper_found', to fetch the helper's fuzzy area
 */
export default function NearbySearchMap({ lat, lng, status, escalationId }) {
  const hasLoc = lat != null && lng != null && !(lat === 0 && lng === 0)

  const [dots, setDots]     = useState([])
  const [helper, setHelper] = useState(null)   // { lat, lng } | null

  // Ambient dots — ONLY re-runs when the sender's own coordinates change
  // (they don't, for an already-sent alert), so this fetches once and then
  // just polls, exactly like useNearbyUsers.
  useEffect(() => {
    if (!hasLoc) return
    let cancelled = false

    async function fetchDots() {
      const { data, error } = await supabase.rpc('list_famora_social_dots', {
        p_center_lat: lat,
        p_center_lng: lng,
        p_radius_m:   DOTS_RADIUS_M,
      })
      if (cancelled) return
      if (!error && data) {
        // Fresh synthetic id per fetch, same reason useNearbyUsers does this:
        // rows carry no identity and are re-fuzzed every call, so the map
        // should add/remove dots rather than glide one to the next.
        setDots(data.map(d => ({
          id:  `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          lat: d.lat,
          lng: d.lng,
        })))
      } else if (error) {
        console.warn('[NearbySearchMap] list_famora_social_dots failed:', error.message)
      }
    }

    fetchDots()
    const poll = setInterval(fetchDots, DOTS_POLL_MS)
    return () => { cancelled = true; clearInterval(poll) }
  }, [hasLoc, lat, lng])

  // The accepted helper's fuzzy area — fetched once status flips to
  // 'helper_found'. The RPC only ever returns a row in that state, so there
  // is nothing to (re)fetch for any other status.
  useEffect(() => {
    if (status !== 'helper_found' || !escalationId) { setHelper(null); return }
    let cancelled = false
    supabase.rpc('get_accepted_helper_area', { p_escalation_id: escalationId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.warn('[NearbySearchMap] get_accepted_helper_area failed:', error.message); return }
        const row = Array.isArray(data) ? data[0] : data
        if (row?.lat != null && row?.lng != null) setHelper({ lat: row.lat, lng: row.lng })
      })
    return () => { cancelled = true }
  }, [status, escalationId])

  // Map pins: the ambient dots, plus the accepted helper once known. Never
  // includes the sender themselves — this map is situational awareness
  // around them, not a family pin.
  const pins = useMemo(() => {
    const out = {}
    for (const d of dots) out[d.id] = { lat: d.lat, lng: d.lng, kind: 'anonDot' }
    if (helper) out.__helper = { lat: helper.lat, lng: helper.lng, kind: 'helperFound' }
    return out
  }, [dots, helper])

  // A single, stable point (the sender's own position) for the map's one-time
  // auto-fit, kept separate from `pins` on purpose: pins arrive over time (the
  // first dots fetch, later the helper), and framing on whichever of those
  // happened to exist on the first render would drift the camera away from
  // the sender as soon as more data came in. flyTarget below then explicitly
  // centres on the same point at a closer, fixed zoom.
  const selfLocation = useMemo(() => (hasLoc ? { __self: { lat, lng } } : {}), [hasLoc, lat, lng])
  const flyTarget     = useMemo(() => (hasLoc ? { lat, lng } : null), [hasLoc, lat, lng])

  // A GPS-failed alert (0,0) has nothing meaningful to centre a map on.
  if (!hasLoc) return null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <FamilyMap
        pins={pins}
        locations={selfLocation}
        flyTarget={flyTarget}
        followLoc={null}
        following={false}
        onUserPanned={noop}
        renderPopup={noop}
      />
      {status === 'searching' && (
        <div className="nearby-radar-overlay" aria-hidden="true">
          <span className="nearby-radar-ring" />
          <span className="nearby-radar-ring r2" />
          <span className="nearby-radar-ring r3" />
          <span className="nearby-radar-center" />
        </div>
      )}
    </div>
  )
}
