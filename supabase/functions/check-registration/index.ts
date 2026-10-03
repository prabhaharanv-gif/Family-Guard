// check-registration — tells Create Account, BEFORE an SMS code is sent, whether
// a mobile number already has a Kinest account.
//
// Why a function and not a database call from the app: answering "is this
// number registered?" to anyone lets them test lists of numbers, which reveals
// who uses a family-safety app. So the database function behind this
// (phone_registered) is executable by the server role only, and this function
// refuses to answer unless the request carries a valid Cloudflare Turnstile
// token, checked here against Cloudflare. A script cannot mint those in bulk.
//
// This is a courtesy to the person registering (a warning, and no wasted SMS).
// It is NOT the safety guarantee: registration_number_taken still runs after
// the code is verified, so an app that skips or fails this call is still
// stopped there.
//
// Auth: deploy with "Verify JWT" OFF (Edge Functions -> this function ->
// Details). The caller has no session yet, and the app key it sends is a
// publishable key rather than a JWT, so the platform check would reject every
// request. Abuse is limited by the CAPTCHA instead, which is checked below.
//
// Secrets (Edge Functions -> Secrets):
//   TURNSTILE_SECRET_KEY   the Cloudflare Turnstile SECRET key. Never in the app.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// With no TURNSTILE_SECRET_KEY the function refuses (503) rather than answer
// unprotected. The app then carries on to the SMS step as before.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })


// CORS: the app and the website only, not every origin. Applied to the finished
// response, so concurrent requests from different origins cannot mix up headers.
const ALLOWED_ORIGINS = [
  'https://localhost',          // the Android app (Capacitor)
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',      // local development
  'https://famora-family.vercel.app',
  'https://family-guard-five.vercel.app',
]
function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get('Origin') || ''
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[4])
  headers.append('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return json({ error: 'not configured' }, 503)

  let body: { phone?: unknown; captchaToken?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }

  // Ten digits, as the app sends them; the 91 country code is added here.
  const phone = typeof body.phone === 'string' ? body.phone.replace(/[^0-9]/g, '') : ''
  const token = typeof body.captchaToken === 'string' ? body.captchaToken : ''
  if (!/^[0-9]{10}$/.test(phone)) return json({ error: 'bad request' }, 400)
  if (!token) return json({ error: 'captcha required' }, 403)

  // This answers "is this number registered?", so it is the call someone would
  // loop over a list of numbers. The CAPTCHA already slows a script; this also
  // caps one address. Fail open: a broken counter must not stop registration.
  const callerIp = req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await sb.rpc('consume_api_quota', {
      p_key: `ip:${callerIp}`, p_fn: 'check-registration', p_limit: 15, p_window_s: 600,
    })
    if (error) console.warn('[check-registration] quota check failed:', error.message)
    else if (data === false) return json({ error: 'too many requests' }, 429)
  } catch (e) {
    console.warn('[check-registration] quota check failed:', (e as Error).message)
  }

  // Cloudflare confirms the token is real, unexpired and unused.
  const form = new URLSearchParams({ secret, response: token })
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (ip) form.set('remoteip', ip)
  let ok = false
  let codes: string[] = []
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const result = await r.json()
    ok = !!result.success
    codes = Array.isArray(result['error-codes']) ? result['error-codes'] : []
  } catch {
    return json({ error: 'captcha check unavailable' }, 502)
  }
  if (!ok) {
    // Cloudflare's reason codes, for example invalid-input-secret (this function
    // holds the wrong secret), invalid-input-response (the token is not real),
    // timeout-or-duplicate (already used or expired). Generic, no secrets in
    // them, and what makes a rejected CAPTCHA diagnosable.
    console.log('[check-registration] captcha rejected:', JSON.stringify(codes))
    return json({ error: 'captcha failed', codes }, 403)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await supabase.rpc('phone_registered', { p_digits: `91${phone}` })
  if (error) {
    console.error('[check-registration] phone_registered failed:', error.message)
    return json({ error: 'lookup failed' }, 500)
  }
  return json({ registered: data === true })
}

serve(async (req) => withCors(req, await handle(req)))
