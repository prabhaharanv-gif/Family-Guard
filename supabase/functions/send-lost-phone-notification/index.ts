// send-lost-phone-notification — tells a phone that it has been marked lost, or
// that lost mode is over (lost_phone INSERT / UPDATE / DELETE trigger). Goes to
// the lost phone itself only, on every device that person is signed in on.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'

function extractBearer(req: Request): string | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7).trim()
}

// The only legitimate caller is the Postgres trigger that sends the raw
// service_role key straight from Vault as the bearer token (see
// supabase/migrations/20260828190000_fix_edge_function_trigger_payload.sql).
// A previous fallback here decoded a bearer value as an unverified JWT and
// trusted its claims (role/ref/exp) without checking a signature — anyone
// who could reach this function's URL could forge one. Removed rather than
// fixed: no legitimate caller ever needed it.
function isServiceRoleJwt(token: string, serviceRoleKey: string): boolean {
  return !!token && !!serviceRoleKey && token === serviceRoleKey
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const bearerToken = extractBearer(req)
  if (!bearerToken || !isServiceRoleJwt(bearerToken, srKey)) {
    console.warn('[LOST-FN] Rejected: unauthorized caller')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const rawBody = await req.text()
    if (!rawBody || rawBody.trim() === '') return new Response('Empty body', { status: 200 })
    let parsed: any
    try { parsed = JSON.parse(rawBody) } catch { return new Response('Ignored: non-JSON body', { status: 200 }) }

    const record = parsed?.record
    if (!record || !isValidUUID(record.user_id)) return new Response('Invalid payload', { status: 400 })
    const stop = parsed?.type === 'DELETE'

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    // Re-read the row rather than trust the webhook body's message/starter_name
    // directly (same defence-in-depth as send-place-notification): user_id is
    // the row's own primary key, so this also confirms lost mode is genuinely
    // active for a start event. A stop event has nothing left to read back —
    // the row is already gone by the time DELETE fires.
    let verified = record
    if (!stop) {
      const { data: row } = await supabase
        .from('lost_phone')
        .select('user_id, starter_name, message, expires_at')
        .eq('user_id', record.user_id)
        .maybeSingle()
      if (!row) {
        console.warn('[LOST-FN] Row not found for start event — ignoring')
        return new Response('Record not found', { status: 200 })
      }
      verified = row
    }

    const { data: tokens } = await supabase.from('device_tokens').select('token').eq('user_id', record.user_id)
    const unique = [...new Set((tokens || []).map((t: any) => t.token))]
    if (unique.length === 0) return new Response('No tokens', { status: 200 })

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) return new Response('Config error', { status: 500 })
    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch { return new Response('Config error', { status: 500 }) }
    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) return new Response('Auth error', { status: 500 })

    const expiresAt = verified.expires_at ? Math.floor(new Date(verified.expires_at).getTime() / 1000) : 0
    const payload = {
      data: {
        type:    'lost_phone',
        action:  stop ? 'stop' : 'start',
        message: String(verified.message || ''),
        starter: String(verified.starter_name || ''),
        until:   String(expiresAt),
      },
      // High priority so a sleeping phone hears it; lost mode is time-critical.
      android: { priority: 'high', ttl: stop ? '600s' : '3600s' },
    }
    const results = await Promise.all(unique.map(t => sendFCM(t, payload, accessToken)))
    let ok = 0
    results.forEach((r: any) => { if (r.error) console.error('[LOST-FN] FCM error:', r.error.code || 'unknown'); else ok++ })
    console.log('[LOST-FN] ' + (stop ? 'stop' : 'start') + ' — ' + ok + '/' + unique.length + ' delivered')
    return new Response(JSON.stringify({ sent: ok, total: unique.length }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('[LOST-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
