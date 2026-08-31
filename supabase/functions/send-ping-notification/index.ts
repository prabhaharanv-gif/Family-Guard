// send-ping-notification — FCM push for "Find My Device" (device_pings INSERT trigger).
// Structure mirrors send-call-notification/index.ts closely — same service_role
// verification, same Firebase service-account OAuth flow, same data-only payload
// strategy so onMessageReceived() runs and can start PingRingService while the
// target's app is backgrounded or killed.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'
const PROJECT_REF = 'xiwfmunwodovzpzicyvu'

// ── JWT verification helpers (identical to send-call-notification) ───────────
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
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
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
  if (!tokenData.access_token) {
    console.error('[PING-FN] Google OAuth rejected JWT — check service account')
  }
  return tokenData.access_token
}

async function sendFCM(token: string, payload: object, accessToken: string) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ message: { token, ...payload } }),
    }
  )
  return res.json()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const bearerToken = extractBearer(req)
  if (!bearerToken || !isServiceRoleJwt(bearerToken, srKey)) {
    console.warn('[PING-FN] Rejected: unauthorized caller (not service_role)')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const rawBody = await req.text()
    if (!rawBody || rawBody.trim() === '') {
      return new Response('Empty body', { status: 200 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return new Response('Ignored: non-JSON body', { status: 200 })
    }

    const record = parsed?.record
    if (!record) return new Response('No record', { status: 200 })

    if (!isValidUUID(record.id) || !isValidUUID(record.target_user_id) ||
        !isValidUUID(record.sent_by) || !isValidUUID(record.family_id)) {
      console.warn('[PING-FN] Invalid payload — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    const { data: verifiedPing } = await supabase
      .from('device_pings')
      .select('id, target_user_id, sent_by, family_id')
      .eq('id', record.id)
      .eq('target_user_id', record.target_user_id)
      .eq('sent_by', record.sent_by)
      .single()

    if (!verifiedPing) {
      console.warn('[PING-FN] Ping record verification failed — not found in DB')
      return new Response('Record not found', { status: 200 })
    }

    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('family_id', record.family_id)
      .eq('user_id',   record.target_user_id)

    if (!tokens || tokens.length === 0) {
      return new Response('No tokens', { status: 200 })
    }

    const { data: sender } = await supabase
      .from('family_members')
      .select('display_name')
      .eq('user_id',   record.sent_by)
      .eq('family_id', record.family_id)
      .maybeSingle()

    const senderName = sender?.display_name || 'A family member'
    console.log(`[PING-FN] Sending to ${tokens.length} device(s) for target ${record.target_user_id}`)

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) {
      console.error('[PING-FN] FIREBASE_SERVICE_ACCOUNT missing')
      return new Response('Config error', { status: 500 })
    }

    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      console.error('[PING-FN] Cannot parse FIREBASE_SERVICE_ACCOUNT')
      return new Response('Config error', { status: 500 })
    }

    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) {
      console.error('[PING-FN] Failed to obtain Firebase access token')
      return new Response('Auth error', { status: 500 })
    }

    // DATA-ONLY payload — same reasoning as send-call-notification. A
    // `notification` block is rendered by Android itself and skips
    // onMessageReceived() while the app is backgrounded, which would leave
    // PingRingService unstarted: a silent banner instead of a ringing phone,
    // exactly the bug this function exists to fix.
    //
    // ttl 45s: a ping is only useful while the person is still looking. The
    // ring itself lasts 30 s, so a push delivered after ~45 s is just noise.
    const fcmPayload = {
      data: {
        type:      'ping',
        ping_id:   String(record.id),
        sender:    senderName,
        family_id: String(record.family_id),
      },
      android: {
        priority: 'high',
        ttl:      '45s',
      },
    }

    const results = await Promise.all(
      tokens.map(({ token }) => sendFCM(token, fcmPayload, accessToken))
    )

    let successCount = 0
    results.forEach((r) => {
      if (r.error) {
        console.error('[PING-FN] FCM delivery error:', r.error.code || 'unknown')
      } else {
        successCount++
      }
    })

    console.log(`[PING-FN] Done — ${successCount}/${tokens.length} delivered`)
    return new Response(
      JSON.stringify({ sent: successCount, total: tokens.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[PING-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
