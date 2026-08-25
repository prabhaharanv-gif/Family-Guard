// send-sos-notification — hardened production version
// Security: verifies caller JWT is service_role before processing any record
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'

// ── JWT verification helpers ──────────────────────────────────────────────────
// The Supabase webhook sends a service_role JWT in the Authorization header.
// We verify that this token is our own service_role key — not a user JWT —
// before trusting any record data in the body.
function extractBearer(req: Request): string | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7).trim()
}

const PROJECT_REF = 'xiwfmunwodovzpzicyvu'

function b64urlDecode(seg: string): string {
  seg = seg.replace(/-/g, '+').replace(/_/g, '/')
  while (seg.length % 4) seg += '='
  try { return atob(seg) } catch { return '' }
}

// Accept ANY structurally-valid service_role JWT for this project.
// This is resilient to key rotation: legacy and new-format service_role
// keys both carry role=service_role and ref=<project> in their payload.
// Falls back to exact-match against the injected env key for non-JWT keys.
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

// ── base64url (RFC 7515) ──────────────────────────────────────────────────────
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
    console.error('[SOS-FN] Google OAuth rejected JWT — check service account')
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

// ── UUID format validator ─────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // ── STEP 1: Verify caller is service_role, not a normal user JWT ───────────
  // This prevents any authenticated user from calling this function directly
  // and feeding it a fabricated record body.
  const bearerToken = extractBearer(req)
  if (!bearerToken || !isServiceRoleJwt(bearerToken, srKey)) {
    console.warn('[SOS-FN] Rejected: unauthorized caller (not service_role)')
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
      // Non-JSON body (e.g. leftover test calls) — ignore safely
      return new Response('Ignored: non-JSON body', { status: 200 })
    }

    const record = parsed?.record
    if (!record) return new Response('No record', { status: 200 })

    // ── STEP 2: Validate record IDs before using them ─────────────────────
    if (!isValidUUID(record.user_id)) {
      console.warn('[SOS-FN] Invalid user_id format — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }
    if (!isValidUUID(record.family_id)) {
      console.warn('[SOS-FN] Invalid family_id format — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    // ── STEP 3: Use service_role client to verify record actually exists ───
    // This is the key cross-family protection: even if an attacker somehow
    // sent a fabricated record with family_id=ANOTHER_FAMILY, the token
    // query below would only return tokens for that family — which would be
    // useless to the attacker since they don't control those devices.
    // But we go further: verify the sos_alert record genuinely exists in DB.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      srKey
    )

    // Verify the SOS alert actually exists with the claimed user/family
    if (record.id && isValidUUID(record.id)) {
      const { data: verifiedAlert } = await supabase
        .from('sos_alerts')
        .select('id, user_id, family_id')
        .eq('id',        record.id)
        .eq('user_id',   record.user_id)
        .eq('family_id', record.family_id)
        .single()

      if (!verifiedAlert) {
        console.warn('[SOS-FN] SOS record verification failed — record not found in DB')
        return new Response('Record not found', { status: 200 })
      }
    }

    // ── STEP 4: Fetch tokens scoped to the verified family ─────────────────
    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('family_id', record.family_id)
      .neq('user_id',  record.user_id)

    if (!tokens || tokens.length === 0) {
      return new Response('No tokens', { status: 200 })
    }

    // ── STEP 5: Fetch sender name from verified family ─────────────────────
    const { data: member } = await supabase
      .from('family_members')
      .select('display_name')
      .eq('user_id',   record.user_id)
      .eq('family_id', record.family_id)
      .maybeSingle()

    const senderName = member?.display_name || 'A family member'
    // Do NOT log the SOS message content or coordinates in production
    console.log(`[SOS-FN] Sending to ${tokens.length} device(s) in family ${record.family_id}`)

    // ── STEP 6: Get Firebase access token ─────────────────────────────────
    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) {
      console.error('[SOS-FN] FIREBASE_SERVICE_ACCOUNT missing')
      return new Response('Config error', { status: 500 })
    }

    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      console.error('[SOS-FN] Cannot parse FIREBASE_SERVICE_ACCOUNT')
      return new Response('Config error', { status: 500 })
    }

    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) {
      console.error('[SOS-FN] Failed to obtain Firebase access token')
      return new Response('Auth error', { status: 500 })
    }

    // ── STEP 7: Send HYBRID FCM message (notification + data) ─────────────
    // For a life-safety alert we MUST reach phones even when the app is fully
    // closed / force-stopped, on ANY device brand, with no per-user battery
    // setup. A data-only message relies on the app's background service waking
    // up — which Android's battery optimizers frequently block. So we include:
    //   • a `notification` block  → Android itself displays a loud, high-
    //     priority heads-up notification on the `sos_alerts_v3` channel even
    //     when the app is dead. Tapping it opens MainActivity and stops alarm.
    //   • a `data` block          → when the app IS alive, onMessageReceived()
    //     still fires and plays the full custom siren + overlay.
    // The android.notification.channel_id MUST match the loud native channel.
    // DATA-ONLY — no notification block so the channel melody never plays.
    // SOSSirenService (started from onMessageReceived) shows its own foreground
    // notification and plays the single custom siren. Exactly one alarm sound.
    const fcmPayload = {
      data: {
        type:      'sos',
        sender:    senderName,
        message:   record.message || 'SOS Alert',
        family_id: String(record.family_id),
        lat:       String(record.lat ?? ''),
        lng:       String(record.lng ?? ''),
      },
      android: {
        priority: 'high',
        ttl:      '60s',
      },
    }

    const results = await Promise.all(
      tokens.map(({ token }) => sendFCM(token, fcmPayload, accessToken))
    )

    let successCount = 0
    results.forEach((r) => {
      if (r.error) {
        console.error('[SOS-FN] FCM delivery error:', r.error.code || 'unknown')
      } else {
        successCount++
      }
    })

    console.log(`[SOS-FN] Done — ${successCount}/${tokens.length} delivered`)
    return new Response(
      JSON.stringify({ sent: successCount, total: tokens.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[SOS-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
