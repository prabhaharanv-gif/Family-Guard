// generate-agora-token — mints a short-lived Agora RTC token for a call channel.
//
// Unlike send-sos-notification / send-message-notification (which are only ever
// invoked by the DB trigger with a service_role JWT), this function is invoked
// DIRECTLY BY THE CLIENT with the calling user's own session JWT. We use that
// JWT as the Supabase client's auth so Row Level Security itself enforces that
// the caller can only fetch a `calls` row they're a participant in — no manual
// participant check needed, RLS ("participants read own calls" policy) does it.
//
// Being client-invoked (not trigger-invoked) also means the browser/WebView
// enforces CORS on it — the Capacitor Android app serves from origin
// https://localhost, which fails the preflight OPTIONS check without these
// headers, so the whole request never reaches this code (surfaced client-side
// as a generic "Failed to send a request to the Edge Function").
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RtcTokenBuilder, RtcRole } from 'npm:agora-token@2.0.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) {
    return new Response('Missing Authorization header', { status: 401, headers: corsHeaders })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: corsHeaders })
  }

  const callId = body?.call_id
  if (!isValidUUID(callId)) {
    return new Response('Invalid call_id', { status: 400, headers: corsHeaders })
  }

  // Client authenticated AS THE CALLING USER — RLS does the participant check.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  const { data: call, error: callErr } = await supabase
    .from('calls')
    .select('id, agora_channel_name, status, caller_id, callee_id')
    .eq('id', callId)
    .single()

  if (callErr || !call) {
    // Either doesn't exist, or RLS hid it because this user isn't a participant.
    return new Response('Call not found', { status: 404, headers: corsHeaders })
  }

  if (call.status !== 'ringing' && call.status !== 'accepted') {
    return new Response('Call is no longer active', { status: 409, headers: corsHeaders })
  }

  const appId = Deno.env.get('AGORA_APP_ID')
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE')
  if (!appId || !appCertificate) {
    console.error('[AGORA-TOKEN] AGORA_APP_ID / AGORA_APP_CERTIFICATE missing')
    return new Response('Config error', { status: 500, headers: corsHeaders })
  }

  // uid 0 = Agora's documented wildcard — token is valid for whatever numeric
  // uid the client picks at join() time. Fine for a 1:1 call with no uid registry.
  const uid = 0
  const expirationTimeInSeconds = 3600
  const currentTimestamp = Math.floor(Date.now() / 1000)
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    call.agora_channel_name,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs
  )

  return new Response(
    JSON.stringify({ token, appId, channelName: call.agora_channel_name, uid }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
