// member-weather — current weather at family members' approximate locations,
// for the Family card.
//
// Provider: OpenWeatherMap "current weather" (2.5). It was Open-Meteo until
// 2026-09-22, when a clear, hot afternoon in Tiruppur showed as drizzle under
// 100% cloud: Open-Meteo is a forecast MODEL, and every model it offered
// believed the sky was overcast. OpenWeatherMap's current conditions blend in
// station and satellite observations, so they track what is outside now far
// better. Its free tier also allows commercial use, which Open-Meteo's does not.
//
// The key is the OPENWEATHER_API_KEY secret (Edge Functions -> Secrets); it
// never reaches the app.
//
// Why a function rather than the app calling the provider directly:
//  - the weather provider never sees a member's phone or IP address, only this
//    server asking about a rounded point;
//  - points are rounded to 0.1 degree (about 11 km) BEFORE they leave here, so
//    no exact position goes to a third party;
//  - one request per rounded point, cached for 15 minutes (the provider updates
//    about every 10), which keeps us far inside the free tier;
//  - the app still receives WMO weather codes, the vocabulary it was built on,
//    so switching provider is a change to this file only, with no app update.
//
// Auth: deployed with JWT verification ON (the dashboard default), which
// checks the token's signature — but the public anon key, shipped inside every
// copy of the app, passes that check too. So the function also requires the
// token to be a SIGNED-IN user's (role "authenticated"); otherwise anyone with
// the anon key could use it as a free weather proxy and exhaust the daily
// quota for the whole family. The coordinates come from the caller, who can
// already see them on their own Family screen.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const MAX_POINTS = 20
const CACHE_MS   = 15 * 60 * 1000

type Weather = { temp: number; code: number; isDay: boolean; gust: number }

// Per-isolate and best effort: a cold start simply fetches again.
const cache = new Map<string, { at: number; w: Weather }>()

const round1 = (v: number) => Math.round(v * 10) / 10
const keyOf  = (lat: number, lng: number) => `${round1(lat).toFixed(1)},${round1(lng).toFixed(1)}`

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// The platform has already verified the signature (Verify JWT is on), so the
// payload can be trusted; this only reads who the token belongs to.
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/**
 * OpenWeatherMap condition id -> WMO code (what the app's lib/weather.js reads).
 * https://openweathermap.org/weather-conditions
 *
 * Trace drizzle (under 0.3 mm in the last hour) is reported as overcast: a
 * rain icon for a dry street is exactly the complaint that led here.
 */
function owmToWmo(id: number, rain1h: number): number {
  if (id >= 200 && id < 300) return 95                     // thunderstorm
  if (id >= 300 && id < 400) return rain1h >= 0.3 ? 53 : 3 // drizzle, or trace = cloud
  if (id === 500) return 61                                // light rain
  if (id === 501) return 63                                // moderate rain
  if (id >= 502 && id <= 504) return 65                    // heavy rain
  if (id === 511) return 66                                // freezing rain
  if (id === 520 || id === 521) return 80                  // showers
  if (id === 522 || id === 531) return 82                  // heavy / ragged showers
  if (id >= 600 && id < 700) return 73                     // snow
  if (id === 771 || id === 781) return 95                  // squall, tornado: treat as storm
  // Haze, smoke, dust and sand are what Indian cities report on bright, hot
  // afternoons (the sun is out, visibility is not): shown as sun, not fog.
  if (id === 711 || id === 721 || id === 731 || id === 751 || id === 761 || id === 762) return 0
  if (id >= 700 && id < 800) return 45                     // mist, fog
  if (id === 800) return 0                                 // clear
  if (id === 801 || id === 802) return 2                   // few / scattered clouds
  return 3                                                 // broken / overcast
}

// ── Detail for one member (the weather sheet) ────────────────────────────────
// A second kind of request, { detail: { lat, lng } }, returns what the sheet
// shows: the current reading in full, the next few forecast steps, the coming
// days, and the air quality. The list request above is untouched, so an app
// build that only knows that one keeps working.

type Detail = {
  tz: number                                   // seconds east of UTC at the place
  now: { temp: number; feels: number; humidity: number; windKmh: number; code: number; isDay: boolean; pop: number | null; high: number; low: number }
  hourly: { ts: number; temp: number; code: number; isDay: boolean; pop: number }[]
  daily: { ts: number; high: number; low: number; code: number; pop: number }[]
  aqi: number | null                           // 1 good .. 5 very poor
}
const detailCache = new Map<string, { at: number; d: Detail }>()

async function getJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`)
  return res.json()
}

async function fetchDetail(key: string, lat: number, lng: number): Promise<Detail | null> {
  const q = `lat=${lat}&lon=${lng}&units=metric&appid=${encodeURIComponent(key)}`
  const base = 'https://api.openweathermap.org/data/2.5'
  const [cur, fc, air] = await Promise.all([
    getJson(`${base}/weather?${q}`),
    getJson(`${base}/forecast?${q}`),
    getJson(`${base}/air_pollution?lat=${lat}&lon=${lng}&appid=${encodeURIComponent(key)}`).catch(() => null),
  ])
  const id = Number(cur?.weather?.[0]?.id), temp = Number(cur?.main?.temp)
  if (!Number.isFinite(id) || !Number.isFinite(temp)) return null

  const tz = Number(fc?.city?.timezone ?? cur?.timezone ?? 0)
  const list: any[] = Array.isArray(fc?.list) ? fc.list : []
  const step = (e: any) => ({
    ts:    Number(e.dt) * 1000,
    temp:  Math.round(Number(e.main?.temp)),
    hi:    Number(e.main?.temp_max),
    lo:    Number(e.main?.temp_min),
    code:  owmToWmo(Number(e.weather?.[0]?.id), Number(e.rain?.['3h'] ?? 0) / 3),
    isDay: String(e.sys?.pod ?? 'd') === 'd',
    pop:   Math.round(Number(e.pop ?? 0) * 100),
  })
  const steps = list.map(step).filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.temp))

  // Local calendar day of a moment at this place.
  const dayOf = (ts: number) => new Date(ts + tz * 1000).toISOString().slice(0, 10)
  const todayKey = dayOf(Date.now())
  const todays = steps.filter((x) => dayOf(x.ts) === todayKey)
  const high = Math.round(Math.max(temp, ...todays.map((x) => x.hi)))
  const low  = Math.round(Math.min(temp, ...todays.map((x) => x.lo)))

  // The coming days: highest and lowest of the day's steps, the icon from the step
  // nearest midday, the chance of rain as the day's highest.
  const byDay = new Map<string, typeof steps>()
  for (const x of steps) {
    const k = dayOf(x.ts)
    if (k === todayKey) continue
    byDay.set(k, [...(byDay.get(k) ?? []), x])
  }
  const daily = [...byDay.entries()].slice(0, 5).map(([k, xs]) => {
    const noon = Date.parse(k + 'T12:00:00Z') - tz * 1000
    const mid = xs.reduce((a, b) => (Math.abs(b.ts - noon) < Math.abs(a.ts - noon) ? b : a))
    return {
      ts: noon,
      high: Math.round(Math.max(...xs.map((x) => x.hi))),
      low:  Math.round(Math.min(...xs.map((x) => x.lo))),
      code: mid.code,
      pop:  Math.max(...xs.map((x) => x.pop)),
    }
  })

  const aqi = Number(air?.list?.[0]?.main?.aqi)
  return {
    tz,
    now: {
      temp: Math.round(temp),
      feels: Math.round(Number(cur?.main?.feels_like ?? temp)),
      humidity: Math.round(Number(cur?.main?.humidity ?? 0)),
      windKmh: Math.round(Number(cur?.wind?.speed ?? 0) * 3.6),
      code: owmToWmo(id, Number(cur?.rain?.['1h'] ?? 0)),
      isDay: String(cur?.weather?.[0]?.icon ?? 'd').endsWith('d'),
      pop: steps.length ? steps[0].pop : null,
      high, low,
    },
    hourly: steps.slice(0, 9).map(({ ts, temp, code, isDay, pop }) => ({ ts, temp, code, isDay, pop })),
    daily,
    aqi: Number.isFinite(aqi) && aqi >= 1 && aqi <= 5 ? aqi : null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)
  if (!isSignedInUser(req))     return json({ error: 'Sign in required' }, 401)

  let points: { lat: number; lng: number }[]
  let wantDetail: { lat: number; lng: number } | null = null
  try {
    const body = await req.json()
    points = Array.isArray(body?.points) ? body.points : []
    if (body?.detail) wantDetail = { lat: Number(body.detail.lat), lng: Number(body.detail.lng) }
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }

  if (wantDetail) {
    const { lat, lng } = wantDetail
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      return json({ error: 'Bad point' }, 400)
    }
    const key = Deno.env.get('OPENWEATHER_API_KEY')
    if (!key) { console.warn('[member-weather] OPENWEATHER_API_KEY is not set'); return json({ error: 'not configured' }, 503) }
    const k = keyOf(lat, lng)
    const hit = detailCache.get(k)
    if (hit && Date.now() - hit.at < CACHE_MS) return json({ detail: hit.d })
    try {
      // Rounded to the same 0.1 degree cell as the list request.
      const d = await fetchDetail(key, round1(lat), round1(lng))
      if (!d) return json({ error: 'no weather' }, 502)
      detailCache.set(k, { at: Date.now(), d })
      return json({ detail: d })
    } catch (e) {
      console.warn('[member-weather] detail:', (e as Error).message)
      return json({ error: 'weather unavailable' }, 502)
    }
  }

  // Unique rounded cells, valid numbers only.
  const cells = new Map<string, { lat: number; lng: number }>()
  for (const p of points.slice(0, MAX_POINTS)) {
    const lat = Number(p?.lat), lng = Number(p?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue
    cells.set(keyOf(lat, lng), { lat: round1(lat), lng: round1(lng) })
  }

  const now = Date.now()
  const result: Record<string, Weather> = {}
  const missing: string[] = []
  for (const k of cells.keys()) {
    const hit = cache.get(k)
    if (hit && now - hit.at < CACHE_MS) result[k] = hit.w
    else missing.push(k)
  }

  const key = Deno.env.get('OPENWEATHER_API_KEY')
  if (missing.length && !key) console.warn('[member-weather] OPENWEATHER_API_KEY is not set')
  if (missing.length && key) {
    // One call per area; the free tier allows 60 a minute and a family rarely
    // spans more than a few areas.
    await Promise.all(missing.map(async (k) => {
      const { lat, lng } = cells.get(k)!
      const url = 'https://api.openweathermap.org/data/2.5/weather'
        + `?lat=${lat}&lon=${lng}&units=metric&appid=${encodeURIComponent(key)}`
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`)
        const d = await res.json()
        const id = Number(d?.weather?.[0]?.id)
        const temp = Number(d?.main?.temp)
        if (!Number.isFinite(id) || !Number.isFinite(temp)) return
        const w: Weather = {
          temp:  Math.round(temp),
          code:  owmToWmo(id, Number(d?.rain?.['1h'] ?? 0)),
          isDay: String(d?.weather?.[0]?.icon ?? 'd').endsWith('d'),
          // m/s to km/h; gust when reported, else the steady wind.
          gust:  Math.round(Number(d?.wind?.gust ?? d?.wind?.speed ?? 0) * 3.6),
        }
        cache.set(k, { at: now, w })
        result[k] = w
      } catch (e) {
        // Weather is decoration: this area simply shows none this time.
        console.warn('[member-weather]', (e as Error).message)
      }
    }))
  }

  return json({ weather: result })
})
