// send-sos-notification — hardened production version
// Security: verifies caller JWT is service_role before processing any record
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'family-guard-b343f'

// ── JWT verification helpers ──────────────────────────────────────────────────
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
      return new Response('Ignored: non-JSON body', { status: 200 })
    }

    const record = parsed?.record
    if (!record) return new Response('No record', { status: 200 })

    if (!isValidUUID(record.user_id)) {
      console.warn('[SOS-FN] Invalid user_id format — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }
    if (!isValidUUID(record.family_id)) {
      console.warn('[SOS-FN] Invalid family_id format — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      srKey
    )

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

    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('family_id', record.family_id)
      .neq('user_id',  record.user_id)

    if (!tokens || tokens.length === 0) {
      return new Response('No tokens', { status: 200 })
    }

    const { data: member } = await supabase
      .from('family_members')
      .select('display_name, phone')
      .eq('user_id',   record.user_id)
      .eq('family_id', record.family_id)
      .maybeSingle()

    const senderName = member?.display_name || 'A family member'

    // For the alert's Call button. family_members.phone is only filled when
    // the person typed it into that family; the account-level number in
    // user_profiles is the fallback. Empty means the app hides Call.
    let senderPhone: string = member?.phone || ''
    if (!senderPhone) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('phone')
        .eq('user_id', record.user_id)
        .maybeSingle()
      senderPhone = profile?.phone || ''
    }
    console.log(`[SOS-FN] Sending to ${tokens.length} device(s) in family ${record.family_id}`)

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

    // ── STEP 7: Send a DATA-ONLY FCM payload ─────────────────────────────────
    //
    // This was a "hybrid" payload — a `notification` block alongside the data —
    // on the belief that the data block would still reach onMessageReceived()
    // in the background. It does not, and that single wrong assumption was the
    // whole SOS failure.
    //
    // FCM's actual rule: if a message carries a `notification` block, the
    // Firebase SDK renders it ITSELF whenever the app is not in the foreground,
    // and onMessageReceived() is never called. The data is handed over only if
    // the user taps the tray entry. So on a locked or backgrounded phone —
    // every real SOS — SOSSirenService never started, the siren never played
    // and SOSAlertActivity was never launched. The recipient got the SDK's
    // plain banner and nothing else. Confirmed on-device by the notification
    // tag the SDK stamps on its own entries: "FCM-Notification:238017546".
    //
    // It also silently mis-routed the sound. The block pinned
    // channel_id 'sos_alerts_v3', a channel the app no longer creates (it is
    // on sos_alerts_v4 / sos_alerts_v4_dnd now), so Android fell back to a
    // default channel: ordinary importance, ordinary notification sound, no
    // DND bypass. That is why an SOS went quiet on a silenced phone — the
    // STREAM_ALARM siren that is exempt from ringer-silent never ran at all.
    //
    // Data-only is what makes the app's own code run. A high-priority data
    // message wakes the app out of Doze and App Standby, which is exactly how
    // the sos_resolved path above already works. The old comment's argument
    // for the block — that it survives a FORCE-STOPPED app — does not hold
    // either: a force-stopped app receives no FCM at all, notification block
    // or not, until the user opens it again.
    //
    // If the alert still cannot reach the screen, the app posts its own
    // fallback (MyFirebaseMessagingService.showSosNotification) on the right
    // channel and with a live full-screen intent — strictly better than
    // anything the SDK would have drawn here.
    // ── Resolved: silence the alarm instead of raising one ───────────────────
    //
    // The sos_resolved_notification trigger (20260918100000) fires when the
    // sender taps "I am safe now". Before it existed, every family member kept
    // hearing the siren until they dismissed it by hand — the emergency was
    // over and their phones had no way to know.
    //
    // Data-only on purpose: there is nothing to announce, and a notification
    // block would put a banner on screen for an alert that just ended.
    if (record.is_resolved === true) {
      const stopPayload = {
        data: {
          type:      'sos_resolved',
          sos_id:    String(record.id ?? ''),
          family_id: String(record.family_id),
        },
        android: { priority: 'high', ttl: '120s' },
      }
      const stopResults = await Promise.all(
        tokens.map(({ token }) => sendFCM(token, stopPayload, accessToken))
      )
      const stopped = stopResults.filter((r: any) => !r.error).length
      console.log(`[SOS-FN] Resolved — silenced ${stopped}/${tokens.length} device(s)`)
      return new Response(
        JSON.stringify({ resolved: true, sent: stopped, total: tokens.length }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const alertMessage = record.message || 'SOS Alert'
    const fcmPayload = {
      // No `notification` block, deliberately — see STEP 7 above. Adding one
      // back stops onMessageReceived() from running in the background, which
      // disables the siren and the full-screen alert in one go.
      data: {
        type:      'sos',
        sender:    senderName,
        message:   alertMessage,
        family_id: String(record.family_id),
        lat:       String(record.lat ?? ''),
        lng:       String(record.lng ?? ''),
        phone:     senderPhone,
      },
      // android.notification is gone with the block it configured. Channel,
      // importance, visibility and vibration are all decided by the app now,
      // in ensureSosChannelStatic() — one place, and one that cannot drift out
      // of sync with the channel ids the way the hardcoded 'sos_alerts_v3'
      // here had already done.
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
