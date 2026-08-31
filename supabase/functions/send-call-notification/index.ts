// send-call-notification — hybrid FCM push for an incoming call (calls INSERT trigger).
// Structure mirrors send-sos-notification/index.ts closely — same service_role
// verification, same Firebase service-account OAuth flow, same hybrid
// notification+data payload strategy for reliable delivery when the callee's
// app is backgrounded or force-stopped.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'
const PROJECT_REF = 'xiwfmunwodovzpzicyvu'

// ── JWT verification helpers (identical to send-sos-notification) ────────────
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
    console.error('[CALL-FN] Google OAuth rejected JWT — check service account')
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
    console.warn('[CALL-FN] Rejected: unauthorized caller (not service_role)')
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

    if (!isValidUUID(record.id) || !isValidUUID(record.caller_id) ||
        !isValidUUID(record.callee_id) || !isValidUUID(record.family_id)) {
      console.warn('[CALL-FN] Invalid payload — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    // Only notify for a fresh ringing call — an UPDATE row-share on this same
    // trigger would never happen (trigger is AFTER INSERT only) but guard anyway.
    if (record.status !== 'ringing') {
      return new Response('Not a ringing call', { status: 200 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    const { data: verifiedCall } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, family_id')
      .eq('id', record.id)
      .eq('caller_id', record.caller_id)
      .eq('callee_id', record.callee_id)
      .single()

    if (!verifiedCall) {
      console.warn('[CALL-FN] Call record verification failed — not found in DB')
      return new Response('Record not found', { status: 200 })
    }

    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('family_id', record.family_id)
      .eq('user_id',   record.callee_id)

    if (!tokens || tokens.length === 0) {
      return new Response('No tokens', { status: 200 })
    }

    const { data: caller } = await supabase
      .from('family_members')
      .select('display_name, avatar_url')
      .eq('user_id',   record.caller_id)
      .eq('family_id', record.family_id)
      .maybeSingle()

    const callerName = caller?.display_name || 'A family member'
    const callType = record.call_type === 'video' ? 'Video call' : 'Voice call'
    console.log(`[CALL-FN] Sending to ${tokens.length} device(s) for callee ${record.callee_id}`)

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) {
      console.error('[CALL-FN] FIREBASE_SERVICE_ACCOUNT missing')
      return new Response('Config error', { status: 500 })
    }

    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      console.error('[CALL-FN] Cannot parse FIREBASE_SERVICE_ACCOUNT')
      return new Response('Config error', { status: 500 })
    }

    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) {
      console.error('[CALL-FN] Failed to obtain Firebase access token')
      return new Response('Auth error', { status: 500 })
    }

    // DATA-ONLY payload — deliberately no `notification` block.
    //
    // A `notification` block is rendered by Android itself, and in that case
    // onMessageReceived() is NOT called while the app is backgrounded. That
    // left CallRingingService unstarted, so the full-screen incoming-call
    // alert never appeared and a second, system-drawn notification rang
    // alongside the app's own — the "no full screen + dual notification"
    // behaviour.
    //
    // Data-only + high priority hands the message to onMessageReceived()
    // instead, which starts the ringing service: looping ringtone, single
    // notification, and the full-screen alert over the lock screen.
    //
    // An earlier data-only attempt appeared to fail completely, but the app
    // was in Android's "stopped" state at the time (freshly installed and
    // never opened), which blocks ALL pushes regardless of payload type — so
    // that test proved nothing about data-only itself.
    //
    // Requirement this creates: the app must be opened once after install,
    // and its process must be startable. This app runs a persistent
    // foreground location service (stopWithTask=false), so the process is
    // normally alive to receive these.
    const fcmPayload = {
      data: {
        type:               'call',
        call_id:            String(record.id),
        caller_name:        callerName,
        // Shown in the full-screen call UI's avatar circle.
        caller_avatar:      String(caller?.avatar_url || ''),
        call_type:          String(record.call_type || 'voice'),
        family_id:          String(record.family_id),
        agora_channel_name: String(record.agora_channel_name || ''),
      },
      android: {
        priority: 'high',
        ttl:      '35s',
      },
    }

    const results = await Promise.all(
      tokens.map(({ token }) => sendFCM(token, fcmPayload, accessToken))
    )

    let successCount = 0
    results.forEach((r) => {
      if (r.error) {
        console.error('[CALL-FN] FCM delivery error:', r.error.code || 'unknown')
      } else {
        successCount++
      }
    })

    console.log(`[CALL-FN] Done — ${successCount}/${tokens.length} delivered`)
    return new Response(
      JSON.stringify({ sent: successCount, total: tokens.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[CALL-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
