// travel-times — real travel time and road distance from the caller to each family
// member, for the Family card's "Reach by" line and its mode icons.
//
// Source: Google Maps Platform, Routes API (computeRoutes). Nothing here is
// estimated from a straight line. A mode is returned ONLY when Google found a real
// route for it, so a member in a place with no bus service simply has no bus entry
// and the app shows no bus icon for them. There is no flight: Google does not
// provide one, and a made-up figure is worse than none.
//
// Per member, up to four lookups:
//   car    DRIVE, with live traffic
//   walk   WALK, only when they are within 15 km in a straight line, and kept only
//          when the walking route is 12 km or less (a 40 km "walk" helps nobody)
//   bus    TRANSIT restricted to buses
//   train  TRANSIT restricted to train, rail, metro and light rail
// Beyond 2,500 km straight-line nothing is looked up at all (no road connects, and
// it would only spend quota); transit is skipped beyond 1,500 km for the same reason.
//
// Transit needs a departure: the first vehicle may leave later than now. The
// response carries departAt (when you would have to set off to catch it) and minutes
// (the whole journey), so the app computes arrival as max(now, departAt) + minutes and
// stays correct while the answer is cached.
//
// Secret: GOOGLE_MAPS_SERVER_KEY (Edge Functions -> Secrets). A SERVER key, with the
// Routes API enabled, restricted to that one API. It is not the Android Maps key: that
// one is locked to the app and would be refused here. It never reaches the app.
//
// Privacy: points are snapped to a 0.002 degree grid (about 200 m) BEFORE they go to
// Google, which also lets neighbouring lookups share a cached answer. Google never
// sees a phone or its IP, only this server asking about two snapped points.
//
// Auth: Verify JWT on, plus the caller must be a signed-in user, as in member-weather:
// the shipped anon key passes the signature check and must not be able to spend the
// Maps quota. Coordinates come from the caller, who can already see them.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_TARGETS   = 10
const CACHE_MS      = 8 * 60 * 1000
const GRID          = 0.002
const NO_LOOKUP_KM  = 2500
const NO_TRANSIT_KM = 1500
const WALK_NEAR_KM  = 15
const WALK_MAX_M    = 12000

type Mode = 'car' | 'walk' | 'bus' | 'train'
type Leg  = { minutes: number; km: number; departAt: string | null }
type Result = Partial<Record<Mode, Leg>> & { error?: boolean }

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function isSignedInUser(req: Request): boolean {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const part = token.split('.')[1]
  if (!part) return false
  try {
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const payload = JSON.parse(atob(b64))
    return payload.role === 'authenticated' && typeof payload.sub === 'string'
  } catch {
    return false
  }
}

const snap = (v: number) => Math.round(v / GRID) * GRID
const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const secs = (d: unknown) => {
  const n = Number(String(d ?? '').replace('s', ''))
  return Number.isFinite(n) ? n : 0
}

// Per-isolate and best effort: a cold start simply asks again.
const cache = new Map<string, { at: number; value: Leg | null }>()

const FIELDS = [
  'routes.duration', 'routes.distanceMeters',
  'routes.legs.steps.staticDuration', 'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails.stopDetails.departureTime',
].join(',')

class MapsError extends Error {}

/** One Routes API call. A Leg when there is a route, null when Google says there is none. */
async function route(
  key: string, mode: Mode,
  from: { lat: number; lng: number }, to: { lat: number; lng: number },
): Promise<Leg | null> {
  const ck = `${mode}|${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat.toFixed(3)},${to.lng.toFixed(3)}`
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const point = (p: { lat: number; lng: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })
  const body: Record<string, unknown> = {
    origin: point(from), destination: point(to),
    travelMode: mode === 'car' ? 'DRIVE' : mode === 'walk' ? 'WALK' : 'TRANSIT',
    units: 'METRIC', languageCode: 'en',
  }
  if (mode === 'car') body.routingPreference = 'TRAFFIC_AWARE'
  if (mode === 'bus') body.transitPreferences = { allowedTravelModes: ['BUS'] }
  if (mode === 'train') body.transitPreferences = { allowedTravelModes: ['TRAIN', 'RAIL', 'SUBWAY', 'LIGHT_RAIL'] }

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(body),
  })

  let value: Leg | null = null
  if (res.status === 404) {
    value = null                                   // no route between these points
  } else if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 200)
    throw new MapsError(`Routes API HTTP ${res.status} ${msg}`)
  } else {
    const d = await res.json()
    const r = d?.routes?.[0]
    if (r && Number.isFinite(secs(r.duration)) && secs(r.duration) > 0) {
      let departAt: string | null = null
      if (mode === 'bus' || mode === 'train') {
        // Walk to the stop takes W; the first vehicle leaves at T. Set off at T - W.
        const steps: Array<Record<string, any>> = r.legs?.[0]?.steps ?? []
        let walked = 0
        for (const s of steps) {
          if (s.travelMode === 'TRANSIT') {
            const t = Date.parse(s.transitDetails?.stopDetails?.departureTime ?? '')
            if (Number.isFinite(t)) departAt = new Date(t - walked * 1000).toISOString()
            break
          }
          walked += secs(s.staticDuration)
        }
      }
      value = {
        minutes:  Math.max(1, Math.round(secs(r.duration) / 60)),
        km:       Math.round((Number(r.distanceMeters) || 0) / 100) / 10,
        departAt,
      }
      if (mode === 'walk' && (Number(r.distanceMeters) || 0) > WALK_MAX_M) value = null
    }
  }
  cache.set(ck, { at: Date.now(), value })
  return value
}


// CORS: the app and the website only, not every origin. Applied to the finished
// response, so concurrent requests from different origins cannot mix up headers.
const ALLOWED_ORIGINS = [
  'https://localhost',          // the Android app (Capacitor)
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',      // local development
  'https://famora-family.vercel.app',
]
function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get('Origin') || ''
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[4])
  headers.append('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Per-user cap on paid lookups: any account can sign in, and each call spends
// quota on a third-party API. Counted in the database (consume_api_quota), so it
// holds across isolates. If the check itself fails the request is allowed: a
// broken counter must not take weather or travel times down.
const QUOTA_LIMIT    = 40
const QUOTA_WINDOW_S = 600
function userIdOf(req: Request): string | null {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  try {
    let b64 = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const sub = JSON.parse(atob(b64))?.sub
    return typeof sub === 'string' ? sub : null
  } catch { return null }
}
async function overQuota(req: Request): Promise<boolean> {
  const uid = userIdOf(req)
  if (!uid) return false
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await sb.rpc('consume_api_quota', {
      p_key: uid, p_fn: 'travel-times', p_limit: QUOTA_LIMIT, p_window_s: QUOTA_WINDOW_S,
    })
    if (error) { console.warn('[travel-times] quota check failed:', error.message); return false }
    return data === false
  } catch (e) {
    console.warn('[travel-times] quota check failed:', (e as Error).message)
    return false
  }
}

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)
  if (!isSignedInUser(req))     return json({ error: 'Sign in required' }, 401)
  if (await overQuota(req))     return json({ error: 'Too many requests' }, 429)

  let origin: { lat: number; lng: number }
  let targets: Array<{ id: string; lat: number; lng: number }>
  try {
    const body = await req.json()
    origin  = { lat: Number(body?.origin?.lat), lng: Number(body?.origin?.lng) }
    targets = Array.isArray(body?.targets) ? body.targets.slice(0, MAX_TARGETS) : []
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }
  if (!valid(origin.lat, origin.lng)) return json({ error: 'Bad origin' }, 400)

  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')
  if (!key) {
    console.warn('[travel-times] GOOGLE_MAPS_SERVER_KEY is not set')
    return json({ error: 'not configured' }, 503)
  }

  const from = { lat: snap(origin.lat), lng: snap(origin.lng) }
  const out: Record<string, Result> = {}

  await Promise.all(targets.map(async (t) => {
    const lat = Number(t?.lat), lng = Number(t?.lng)
    if (typeof t?.id !== 'string' || !valid(lat, lng)) return
    const to = { lat: snap(lat), lng: snap(lng) }
    const km = haversineKm(origin, { lat, lng })
    const result: Result = {}
    out[t.id] = result
    if (km > NO_LOOKUP_KM) return

    const wanted: Mode[] = ['car']
    if (km <= WALK_NEAR_KM)    wanted.push('walk')
    if (km <= NO_TRANSIT_KM)   wanted.push('bus', 'train')

    await Promise.all(wanted.map(async (m) => {
      try {
        const leg = await route(key, m, from, to)
        if (leg) result[m] = leg
      } catch (e) {
        // Quota, a disabled API or a bad key: say so, so the app does not remember
        // "no bus" for a member who simply could not be looked up this time.
        result.error = true
        console.warn('[travel-times]', (e as Error).message)
      }
    }))
  }))

  return json({ times: out })
}

serve(async (req) => withCors(req, await handle(req)))
