// send-place-notification — "X reached/left Home" alerts, mirrors
// send-message-notification's shape exactly (see that file for the FCM
// service-account/JWT plumbing this copies verbatim).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const bearerToken = extractBearer(req)
  if (!bearerToken || !isServiceRoleJwt(bearerToken, srKey)) {
    console.warn('[PLACE-FN] Rejected: unauthorized caller')
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

    if (!isValidUUID(record.user_id) || !isValidUUID(record.family_id)) {
      console.warn('[PLACE-FN] Invalid UUIDs in record — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    // Verify the event actually exists (same defence-in-depth as messages/SOS).
    if (record.id && isValidUUID(record.id)) {
      const { data: verifiedEvent } = await supabase
        .from('place_events')
        .select('id, user_id, family_id')
        .eq('id',        record.id)
        .eq('user_id',   record.user_id)
        .eq('family_id', record.family_id)
        .single()

      if (!verifiedEvent) {
        console.warn('[PLACE-FN] Event record verification failed')
        return new Response('Record not found', { status: 200 })
      }
    }

    const placeName = typeof record.place_name === 'string' && record.place_name
      ? record.place_name.substring(0, 60)
      : 'a place'
    const entered = record.entered === true

    // Fetch sender name
    const { data: sender } = await supabase
      .from('family_members')
      .select('display_name')
      .eq('user_id',   record.user_id)
      .eq('family_id', record.family_id)
      .maybeSingle()

    const senderName = sender?.display_name || 'Family'

    console.log(`[PLACE-FN] ${entered ? 'Entered' : 'Left'} "${placeName}" in family ${record.family_id}`)

    // Tokens for all OTHER family members. user_id comes along so each
    // notification can be addressed with the name THAT recipient uses.
    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token, user_id')
      .eq('family_id', record.family_id)
      .neq('user_id',  record.user_id)

    if (!tokens || tokens.length === 0) return new Response('No tokens', { status: 200 })

    // Same private-nickname resolution as send-message-notification: a
    // nickname is keyed by owner_user_id, so the sender is named differently
    // on different recipients phones.
    const { data: nicknameRows } = await supabase
      .from('member_nicknames')
      .select('owner_user_id, nickname')
      .eq('family_id',      record.family_id)
      .eq('target_user_id', record.user_id)

    const nicknameByOwner = new Map<string, string>()
    for (const row of nicknameRows || []) {
      const nick = typeof row.nickname === 'string' ? row.nickname.trim() : ''
      if (nick) nicknameByOwner.set(row.owner_user_id, nick)
    }

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) return new Response('Config error', { status: 500 })

    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      return new Response('Config error', { status: 500 })
    }

    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) return new Response('Auth error', { status: 500 })

    // ── DATA-ONLY FCM payload ────────────────────────────────────────────
    // Same reason as send-message-notification: a `notification` block would
    // stop onMessageReceived() firing while backgrounded/killed, bypassing
    // the plain-notification path entirely. Deliberately no lat/lng here —
    // family members get the arrival/departure event, not the coordinates.
    const payloadFor = (recipientId: string) => ({
      data: {
        type:       entered ? 'place_enter' : 'place_exit',
        sender:     nicknameByOwner.get(recipientId) || senderName,
        place_name: placeName,
        family_id:  String(record.family_id),
      },
      android: {
        priority: 'high',
        ttl:      '300s',
      },
    })

    const results = await Promise.all(
      tokens.map(({ token, user_id }) => sendFCM(token, payloadFor(user_id), accessToken))
    )

    let successCount = 0
    results.forEach(r => {
      if (r.error) console.error('[PLACE-FN] FCM error:', r.error.code || 'unknown')
      else successCount++
    })
    console.log(`[PLACE-FN] Done — ${successCount}/${tokens.length} delivered`)

    return new Response(
      JSON.stringify({ sent: successCount, total: tokens.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[PLACE-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
