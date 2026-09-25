// send-nearby-help-notification — FCM push for the Famora Social nearby-help
// escalation (nearby_help_notifications INSERT + nearby_help_escalations
// status-change UPDATE triggers).
//
// A separate function on purpose, not a branch inside send-sos-notification:
// that function is the one life-critical, already-hardened SOS path (it has
// its own documented past incident — a `notification` block silently killing
// the siren) and should not gain unrelated branching. This project already
// has one function per notification kind (send-call-notification,
// send-ping-notification, send-dm-notification, etc.) — this follows that.
//
// Structure and JWT/OAuth boilerplate copied from send-ping-notification.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'
const PROJECT_REF = 'xiwfmunwodovzpzicyvu'

// ── JWT verification helpers (identical to the other notification functions) ─
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
    console.error('[NEARBY-FN] Google OAuth rejected JWT — check service account')
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

// Same token can repeat once per family the user belongs to
// (device_tokens is fanned out per family) — dedupe before sending so a
// helper in two families does not get the same push twice.
function dedupeTokens(rows: { token: string }[] | null): string[] {
  if (!rows) return []
  return [...new Set(rows.map(r => r.token))]
}

async function sendToUser(
  supabase: any, userId: string, payload: object, accessToken: string, label: string
): Promise<number> {
  const { data: rows } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', userId)
  const tokens = dedupeTokens(rows)
  if (tokens.length === 0) return 0
  const results = await Promise.all(tokens.map(t => sendFCM(t, payload, accessToken)))
  const sent = results.filter((r: any) => !r.error).length
  console.log(`[NEARBY-FN] ${label} -> ${sent}/${tokens.length} device(s) for user ${userId}`)
  return sent
}

// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const bearerToken = extractBearer(req)
  if (!bearerToken || !isServiceRoleJwt(bearerToken, srKey)) {
    console.warn('[NEARBY-FN] Rejected: unauthorized caller (not service_role)')
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

    const table = parsed?.table
    const record = parsed?.record
    const oldRecord = parsed?.old_record
    if (!record) return new Response('No record', { status: 200 })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) {
      console.error('[NEARBY-FN] FIREBASE_SERVICE_ACCOUNT missing')
      return new Response('Config error', { status: 500 })
    }
    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch {
      console.error('[NEARBY-FN] Cannot parse FIREBASE_SERVICE_ACCOUNT')
      return new Response('Config error', { status: 500 })
    }
    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) {
      console.error('[NEARBY-FN] Failed to obtain Firebase access token')
      return new Response('Auth error', { status: 500 })
    }

    // ── A helper was notified — a new nearby_help_notifications row ──────────
    if (table === 'nearby_help_notifications') {
      if (!isValidUUID(record.id) || !isValidUUID(record.escalation_id) || !isValidUUID(record.helper_id)) {
        console.warn('[NEARBY-FN] Invalid notification payload — rejecting')
        return new Response('Invalid payload', { status: 400 })
      }

      const { data: verified } = await supabase
        .from('nearby_help_notifications')
        .select('id, escalation_id, helper_id, tier, fuzzy_lat, fuzzy_lng, fuzzy_radius_m, help_kind')
        .eq('id', record.id)
        .single()
      if (!verified) {
        console.warn('[NEARBY-FN] Notification record not found in DB — ignoring')
        return new Response('Record not found', { status: 200 })
      }

      // TTL matched to that tiers wait window, so a stale push never lingers
      // past the point the tier has already moved on.
      const ttl = verified.tier === 1 ? '60s' : verified.tier === 2 ? '120s' : '180s'

      // No identity of the SOS sender or their family included — helpers
      // stay anonymous strangers to the sender and vice versa.
      const payload = {
        data: {
          type:           'nearby_help_request',
          notification_id: String(verified.id),
          escalation_id:   String(verified.escalation_id),
          tier:            String(verified.tier),
          fuzzy_lat:       String(verified.fuzzy_lat),
          fuzzy_lng:       String(verified.fuzzy_lng),
          fuzzy_radius_m:  String(verified.fuzzy_radius_m),
          help_kind:       String(verified.help_kind || 'police'),
        },
        android: { priority: 'high', ttl },
      }

      const sent = await sendToUser(supabase, verified.helper_id, payload, accessToken, 'nearby_help_request')
      return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ── An escalations status changed ─────────────────────────────────────
    if (table === 'nearby_help_escalations') {
      if (!isValidUUID(record.id)) {
        console.warn('[NEARBY-FN] Invalid escalation payload — rejecting')
        return new Response('Invalid payload', { status: 400 })
      }
      if (record.status === oldRecord?.status) {
        return new Response('No status change', { status: 200 })
      }

      const { data: esc } = await supabase
        .from('nearby_help_escalations')
        .select('id, sos_alert_id, requester_id, status, accepted_by, help_kind')
        .eq('id', record.id)
        .single()
      if (!esc) {
        console.warn('[NEARBY-FN] Escalation record not found in DB — ignoring')
        return new Response('Record not found', { status: 200 })
      }

      if (esc.status === 'helper_found') {
        // Requester: a count only, never the helpers identity.
        await sendToUser(
          supabase, esc.requester_id,
          { data: { type: 'nearby_help_accepted', sos_alert_id: String(esc.sos_alert_id), help_kind: String(esc.help_kind || 'police') },
            android: { priority: 'high', ttl: '120s' } },
          accessToken, 'nearby_help_accepted'
        )

        // Every other still-unresponded helper: stand down, it is handled.
        const { data: others } = await supabase
          .from('nearby_help_notifications')
          .select('helper_id')
          .eq('escalation_id', esc.id)
          .is('response', null)
          .neq('helper_id', esc.accepted_by ?? '00000000-0000-0000-0000-000000000000')

        const standdownPayload = {
          data: { type: 'nearby_help_standdown', escalation_id: String(esc.id) },
          android: { priority: 'high', ttl: '120s' },
        }
        for (const o of others || []) {
          await sendToUser(supabase, o.helper_id, standdownPayload, accessToken, 'nearby_help_standdown')
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
      }

      if (esc.status === 'exhausted') {
        // Informational fallback for a backgrounded/killed sender app — the
        // foreground case is already covered by Realtime.
        await sendToUser(
          supabase, esc.requester_id,
          { data: { type: 'nearby_help_exhausted', sos_alert_id: String(esc.sos_alert_id), help_kind: String(esc.help_kind || 'police') },
            android: { priority: 'high', ttl: '120s' } },
          accessToken, 'nearby_help_exhausted'
        )
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
      }

      if (esc.status === 'resolved') {
        // Every helper who was ever notified or accepted, so nobody keeps
        // trying to help an emergency that is over.
        const { data: helpers } = await supabase
          .from('nearby_help_notifications')
          .select('helper_id')
          .eq('escalation_id', esc.id)
          .or('response.is.null,response.eq.accepted')

        const cancelPayload = {
          data: { type: 'nearby_help_cancelled', escalation_id: String(esc.id) },
          android: { priority: 'high', ttl: '120s' },
        }
        let sent = 0
        for (const h of helpers || []) {
          sent += await sendToUser(supabase, h.helper_id, cancelPayload, accessToken, 'nearby_help_cancelled')
        }
        return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } })
      }

      return new Response('No action for this status', { status: 200 })
    }

    return new Response('Ignored: unknown table', { status: 200 })

  } catch (err: any) {
    console.error('[NEARBY-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
