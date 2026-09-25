// check-place-weather — warns people about severe weather at their saved Places
// (Home, Office...) so they can plan ahead.
//
// Called every 30 minutes by pg_cron (see the place_weather_alerts migration).
// For every distinct place area (rounded to 0.1 degree, about 11 km, before
// anything leaves here) it reads OpenWeatherMap's 3-hourly forecast, looks at
// the next 12 hours, and if something severe is coming (thunderstorm, heavy
// rain, 40 C heat, 60 km/h gusts) it records one alert per place and kind and
// sends the place OWNER a data-only push. Nobody else in the family is told:
// places are private to their owner.
//
// De-duplication: at most one alert per place and kind every 12 hours.
// Quiet hours: nothing is sent 23:00 to 06:00 IST; a storm still coming at
// 06:00 is reported then.
//
// The key is the OPENWEATHER_API_KEY secret, same as member-weather.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Severity rules (storm, heavy rain, 40 C heat, 60 km/h gusts) ──────────
type Kind = 'thunderstorm' | 'heavy_rain' | 'heat' | 'wind'

type Step = {
  at: number            // unix seconds the step starts
  id: number            // OpenWeatherMap condition id
  temp: number          // deg C
  gustKmh: number       // km/h
  rain3h: number        // mm in the 3 hours of this step
}

const HEAT_C = 40
const GUST_KMH = 60
const HEAVY_RAIN_3H_MM = 15

// Worst first: what the person most needs to hear about when several apply.
const PRIORITY: Kind[] = ['thunderstorm', 'heavy_rain', 'heat', 'wind']

function kindsFor(s: Step): Kind[] {
  const out: Kind[] = []
  if (s.id >= 200 && s.id < 300) out.push('thunderstorm')
  if ((s.id >= 502 && s.id <= 504) || s.id === 522 || s.id === 531 || s.rain3h >= HEAVY_RAIN_3H_MM) out.push('heavy_rain')
  if (s.temp >= HEAT_C) out.push('heat')
  if (s.gustKmh >= GUST_KMH) out.push('wind')
  return out
}

/** The single most important severe condition in the steps, and the step it starts at. */
function worstOf(steps: Step[]): { kind: Kind; step: Step } | null {
  let best: { kind: Kind; step: Step } | null = null
  for (const step of steps) {
    for (const kind of kindsFor(step)) {
      if (!best) { best = { kind, step }; continue }
      // Higher priority wins; for the same kind the earlier step stays.
      if (PRIORITY.indexOf(kind) < PRIORITY.indexOf(best.kind)) best = { kind, step }
    }
  }
  return best
}

/** OpenWeatherMap 3-hourly forecast list -> Steps. */
function stepsFromForecast(list: any[]): Step[] {
  return (list || []).map((e: any) => ({
    at:      Number(e?.dt) || 0,
    id:      Number(e?.weather?.[0]?.id) || 800,
    temp:    Number(e?.main?.temp_max ?? e?.main?.temp) || 0,
    gustKmh: (Number(e?.wind?.gust ?? e?.wind?.speed) || 0) * 3.6,
    rain3h:  Number(e?.rain?.['3h']) || 0,
  })).filter(s => s.at > 0)
}

const PROJECT_ID  = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'
const PROJECT_REF = 'xiwfmunwodovzpzicyvu'
const LOOKAHEAD_STEPS = 4              // 4 x 3 h = 12 h
const COOLDOWN_MS = 12 * 3600 * 1000

function extractBearer(req: Request): string | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7).trim()
}

function b64urlDecode(seg: string): string {
  seg = seg.replace(/-/g, '+').replace(/_/g, '/')
  while (seg.length % 4) seg += '='
  try { return atob(seg) } catch { return '' }
}

function isServiceRoleJwt(token: string, serviceRoleKey: string): boolean {
  if (token && serviceRoleKey && token === serviceRoleKey) return true
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]))
    if (payload.role !== 'service_role') return false
    if (payload.ref && payload.ref !== PROJECT_REF) return false
    if (payload.exp && Date.now() / 1000 > payload.exp) return false
    return true
  } catch { return false }
}

function b64url(input: string | Uint8Array): string {
  let str: string
  if (typeof input === 'string') {
    str = btoa(unescape(encodeURIComponent(input)))
  } else {
    let binary = ''
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i])
    str = btoa(binary)
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToBinary(pem: string): Uint8Array {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binaryStr = atob(clean)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }))
  const signingInput = `${header}.${payload}`
  const keyBytes  = pemToBinary(serviceAccount.private_key)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${b64url(new Uint8Array(sigBuf))}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }).toString(),
  })
  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

async function sendFCM(token: string, payload: object, accessToken: string) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, ...payload } }),
    }
  )
  return res.json()
}

const round1 = (v: number) => Math.round(v * 10) / 10
const cellOf = (lat: number, lng: number) => `${round1(lat).toFixed(1)},${round1(lng).toFixed(1)}`

serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const bearer = extractBearer(req)
  if (!bearer || !isServiceRoleJwt(bearer, srKey)) {
    console.warn('[PLACE-WX] Rejected: unauthorized caller')
    return new Response('Unauthorized', { status: 401 })
  }

  const owmKey = Deno.env.get('OPENWEATHER_API_KEY')
  if (!owmKey) { console.warn('[PLACE-WX] OPENWEATHER_API_KEY is not set'); return new Response('Config error', { status: 500 }) }

  // Test mode: {"test_user_id": "<uuid>"} sends that person a sample
  // thunderstorm alert for their first saved place, skipping the forecast, the
  // cooldown and the quiet hours, and records nothing. Only reachable with the
  // service key, like everything else here.
  let testUserId = ''
  try {
    const b = JSON.parse((await req.text()) || '{}')
    if (typeof b?.test_user_id === 'string') testUserId = b.test_user_id
  } catch { /* the cron sends {} */ }
  if (testUserId) {
    if (!/^[0-9a-f-]{36}$/i.test(testUserId)) return new Response('Bad test_user_id', { status: 400 })
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)
    const { data: place } = await supabase.from('places').select('name').eq('user_id', testUserId).order('created_at').limit(1).maybeSingle()
    const { data: tokens } = await supabase.from('device_tokens').select('token').eq('user_id', testUserId)
    const unique = [...new Set((tokens || []).map((t: any) => t.token))]
    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!place || unique.length === 0 || !rawSA) return new Response(JSON.stringify({ place: !!place, tokens: unique.length }), { status: 200 })
    const accessToken = await getAccessToken(JSON.parse(rawSA))
    const payload = {
      data: {
        type: 'weather_alert', kind: 'thunderstorm', place_name: String(place.name),
        at: String(Math.floor(Date.now() / 1000) + 2 * 3600), temp: '30', gust: '40', rain: '10',
      },
      android: { priority: 'high', ttl: '600s' },
    }
    const results = await Promise.all(unique.map(t => sendFCM(t, payload, accessToken)))
    return new Response(JSON.stringify({ test: true, tokens: unique.length, results: results.map((r: any) => r.error ? r.error.status || 'error' : 'ok') }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Quiet hours, IST.
  const istHour = Number(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 13))
  if (istHour >= 23 || istHour < 6) return new Response('Quiet hours', { status: 200 })

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    const { data: places } = await supabase.from('places').select('id, user_id, name, lat, lng')
    if (!places || places.length === 0) return new Response('No places', { status: 200 })

    // One forecast per rounded area.
    const cells = new Map<string, { lat: number; lng: number }>()
    for (const p of places) cells.set(cellOf(p.lat, p.lng), { lat: round1(p.lat), lng: round1(p.lng) })
    const forecast = new Map<string, ReturnType<typeof stepsFromForecast>>()
    await Promise.all([...cells.entries()].map(async ([k, c]) => {
      try {
        const res = await fetch('https://api.openweathermap.org/data/2.5/forecast'
          + `?lat=${c.lat}&lon=${c.lng}&units=metric&cnt=${LOOKAHEAD_STEPS}&appid=${encodeURIComponent(owmKey)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        forecast.set(k, stepsFromForecast(j?.list || []))
      } catch (e: any) {
        console.warn('[PLACE-WX] forecast failed for a cell:', e?.message || 'unknown')
      }
    }))

    // Recent alerts, for the cooldown.
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString()
    const { data: recent } = await supabase.from('place_weather_alerts')
      .select('place_id, kind').gte('created_at', since)
    const recentKeys = new Set((recent || []).map((r: any) => `${r.place_id}|${r.kind}`))

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) return new Response('Config error', { status: 500 })
    const accessToken = await getAccessToken(JSON.parse(rawSA))
    if (!accessToken) return new Response('Auth error', { status: 500 })

    // People who switched weather alerts off (Profile -> Safety). No row = on.
    const { data: offRows } = await supabase.from('user_alert_prefs').select('user_id').eq('weather_alerts', false)
    const optedOut = new Set((offRows || []).map((r: any) => r.user_id))

    let sent = 0, raised = 0
    for (const p of places) {
      if (optedOut.has(p.user_id)) continue
      const steps = forecast.get(cellOf(p.lat, p.lng))
      if (!steps) continue
      const worst = worstOf(steps)
      if (!worst) continue
      if (recentKeys.has(`${p.id}|${worst.kind}`)) continue

      const { error: insErr } = await supabase.from('place_weather_alerts').insert({
        user_id: p.user_id, place_id: p.id, place_name: p.name, kind: worst.kind,
        starts_at: new Date(worst.step.at * 1000).toISOString(),
      })
      if (insErr) { console.warn('[PLACE-WX] could not record alert:', insErr.code || 'unknown'); continue }
      raised++

      const { data: tokens } = await supabase.from('device_tokens').select('token').eq('user_id', p.user_id)
      const unique = [...new Set((tokens || []).map((t: any) => t.token))]
      // DATA-ONLY, like every other notification here: a notification block
      // would bypass onMessageReceived while the app is backgrounded.
      const payload = {
        data: {
          type:       'weather_alert',
          kind:       worst.kind,
          place_name: String(p.name),
          at:         String(worst.step.at),
          temp:       String(Math.round(worst.step.temp)),
          gust:       String(Math.round(worst.step.gustKmh)),
          rain:       String(Math.round(worst.step.rain3h)),
        },
        android: { priority: 'high', ttl: '3600s' },
      }
      const results = await Promise.all(unique.map(t => sendFCM(t, payload, accessToken)))
      results.forEach(r => { if (r.error) console.error('[PLACE-WX] FCM error:', r.error.code || 'unknown'); else sent++ })
    }

    console.log(`[PLACE-WX] ${places.length} places, ${raised} alerts, ${sent} pushes`)
    return new Response(JSON.stringify({ places: places.length, alerts: raised, sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[PLACE-WX] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
