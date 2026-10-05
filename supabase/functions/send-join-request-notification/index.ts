// send-join-request-notification — tells the family admins that someone has
// asked to join, so a request is not left waiting until an admin happens to open
// the Family tab. Same plumbing as send-place-notification (service-role-only
// caller, data-only FCM).
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
    console.warn('[JOINREQ-FN] Rejected: unauthorized caller')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const rawBody = await req.text()
    if (!rawBody || rawBody.trim() === '') return new Response('Empty body', { status: 200 })

    let parsed: any
    try { parsed = JSON.parse(rawBody) } catch {
      return new Response('Ignored: non-JSON body', { status: 200 })
    }

    const record = parsed?.record
    if (!record) return new Response('No record', { status: 200 })

    if (!isValidUUID(record.id) || !isValidUUID(record.family_id) || !isValidUUID(record.requester_id)) {
      console.warn('[JOINREQ-FN] Invalid UUIDs in record - rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    // Read the request back rather than trust the webhook body (same
    // defence-in-depth as messages, SOS and places). Only a pending request
    // that really exists is announced.
    const { data: req_ } = await supabase
      .from('join_requests')
      .select('id, family_id, requester_id, requester_name, status')
      .eq('id', record.id)
      .eq('family_id', record.family_id)
      .eq('requester_id', record.requester_id)
      .maybeSingle()
    if (!req_ || req_.status !== 'pending') {
      return new Response('Request not found or not pending', { status: 200 })
    }

    const { data: family } = await supabase
      .from('families')
      .select('name, created_by')
      .eq('id', req_.family_id)
      .maybeSingle()

    // Who can accept it: the family admins, and the owner if the role column
    // were ever out of step with created_by.
    const { data: admins } = await supabase
      .from('family_members')
      .select('user_id')
      .eq('family_id', req_.family_id)
      .eq('role', 'admin')
    const adminIds = new Set<string>((admins || []).map((a: any) => a.user_id))
    if (family?.created_by) adminIds.add(family.created_by)
    adminIds.delete(req_.requester_id)
    if (adminIds.size === 0) return new Response('No admins', { status: 200 })

    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token, user_id')
      .eq('family_id', req_.family_id)
      .in('user_id', [...adminIds])
    if (!tokens || tokens.length === 0) return new Response('No tokens', { status: 200 })

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) return new Response('Config error', { status: 500 })
    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      return new Response('Config error', { status: 500 })
    }
    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) return new Response('Auth error', { status: 500 })

    const requesterName = typeof req_.requester_name === 'string' && req_.requester_name.trim()
      ? req_.requester_name.trim().substring(0, 60)
      : 'Someone'
    const familyName = typeof family?.name === 'string' && family.name.trim()
      ? family.name.trim().substring(0, 60)
      : 'your family'

    console.log(`[JOINREQ-FN] Request to join family ${req_.family_id}, notifying ${tokens.length} device(s)`)

    // DATA-ONLY payload, for the same reason as the other notifications: a
    // notification block would stop onMessageReceived() running while the app
    // is closed. No phone number goes in the push, only the name.
    const payload = {
      data: {
        type:        'join_request',
        sender:      requesterName,
        family_name: familyName,
        family_id:   String(req_.family_id),
      },
      android: { priority: 'high', ttl: '86400s' },
    }

    const results = await Promise.all(tokens.map(({ token }) => sendFCM(token, payload, accessToken)))
    let successCount = 0
    results.forEach(r => {
      if (r.error) console.error('[JOINREQ-FN] FCM error:', r.error.code || 'unknown')
      else successCount++
    })
    console.log(`[JOINREQ-FN] Done - ${successCount}/${tokens.length} delivered`)

    return new Response(
      JSON.stringify({ sent: successCount, total: tokens.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[JOINREQ-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
