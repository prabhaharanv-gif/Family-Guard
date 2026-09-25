// send-unlock-alert-notification — tells a family's ADMINS that someone entered
// the wrong screen-lock password several times on their phone (unlock_alerts
// INSERT trigger). Data-only FCM, no coordinates and no photo in the push: the
// photo and position are read inside the app, where access is checked.
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
    console.warn('[UNLOCK-FN] Rejected: unauthorized caller')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const rawBody = await req.text()
    if (!rawBody || rawBody.trim() === '') return new Response('Empty body', { status: 200 })
    let parsed: any
    try { parsed = JSON.parse(rawBody) } catch { return new Response('Ignored: non-JSON body', { status: 200 }) }

    const record = parsed?.record
    if (!record) return new Response('No record', { status: 200 })
    if (!isValidUUID(record.id) || !isValidUUID(record.user_id) || !isValidUUID(record.family_id)) {
      console.warn('[UNLOCK-FN] Invalid record — rejecting')
      return new Response('Invalid payload', { status: 400 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srKey)

    // Read the alert back rather than trust the webhook body.
    const { data: alert } = await supabase
      .from('unlock_alerts').select('id, user_id, family_id, attempts').eq('id', record.id).single()
    if (!alert) return new Response('Record not found', { status: 200 })

    const { data: owner } = await supabase
      .from('family_members').select('display_name')
      .eq('user_id', alert.user_id).eq('family_id', alert.family_id).maybeSingle()
    const ownerName = owner?.display_name || 'Family'

    // Admins of this family, other than the owner.
    const { data: admins } = await supabase
      .from('family_members').select('user_id')
      .eq('family_id', alert.family_id).eq('role', 'admin').neq('user_id', alert.user_id)
    const adminIds = (admins || []).map((a: any) => a.user_id)
    if (adminIds.length === 0) return new Response('No admins', { status: 200 })

    const { data: tokens } = await supabase
      .from('device_tokens').select('token, user_id').in('user_id', adminIds)
    if (!tokens || tokens.length === 0) return new Response('No tokens', { status: 200 })

    const { data: nicknameRows } = await supabase
      .from('member_nicknames').select('owner_user_id, nickname')
      .eq('family_id', alert.family_id).eq('target_user_id', alert.user_id)
    const nicknameByOwner = new Map<string, string>()
    for (const row of nicknameRows || []) {
      const nick = typeof row.nickname === 'string' ? row.nickname.trim() : ''
      if (nick) nicknameByOwner.set(row.owner_user_id, nick)
    }

    const rawSA = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!rawSA) return new Response('Config error', { status: 500 })
    let serviceAccount: any
    try { serviceAccount = JSON.parse(rawSA) } catch { return new Response('Config error', { status: 500 }) }
    const accessToken = await getAccessToken(serviceAccount)
    if (!accessToken) return new Response('Auth error', { status: 500 })

    const seen = new Set<string>()
    const unique = tokens.filter((t: any) => { if (seen.has(t.token)) return false; seen.add(t.token); return true })

    const results = await Promise.all(unique.map(({ token, user_id }: any) => sendFCM(token, {
      data: {
        type:      'unlock_alert',
        sender:    nicknameByOwner.get(user_id) || ownerName,
        attempts:  String(alert.attempts),
        family_id: String(alert.family_id),
      },
      android: { priority: 'high', ttl: '3600s' },
    }, accessToken)))
    let ok = 0
    results.forEach((r: any) => { if (r.error) console.error('[UNLOCK-FN] FCM error:', r.error.code || 'unknown'); else ok++ })
    console.log('[UNLOCK-FN] Done — ' + ok + '/' + unique.length + ' delivered')

    return new Response(JSON.stringify({ sent: ok, total: unique.length }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('[UNLOCK-FN] Unhandled error:', err?.message || 'unknown')
    return new Response('Internal error', { status: 500 })
  }
})
