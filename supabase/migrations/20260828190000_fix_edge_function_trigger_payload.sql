-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: push notifications never sent — trigger posted an empty body
-- ═══════════════════════════════════════════════════════════════════════════
--
-- trg_notify_edge_function() posted `body := '{}'::jsonb`, so the SOS row was
-- never included in the webhook call. Both edge functions start with:
--
--     const record = parsed?.record
--     if (!record) return new Response('No record', { status: 200 })
--
-- so every invocation returned early and no FCM push was ever sent, for either
-- send-sos-notification or send-message-notification.
--
-- Symptom this produced: SOS alerts appeared to work "only when the app is
-- open" and to do nothing when it was backgrounded or killed. Those are two
-- entirely separate delivery paths, which is why it looked like a client bug:
--
--   * app open   -> Supabase Realtime websocket (useSosAlarm.js) subscribes to
--                   sos_alerts INSERTs directly. Never touches this trigger,
--                   the edge function, or FCM — so it kept working perfectly
--                   and masked the failure.
--   * app killed -> this trigger -> edge function -> FCM push. The only path
--                   available when no app code is running, and it was dead.
--
-- Verified on-device with adb logcat: zero FCM traffic ever arrived for
-- com.scoopfamily.familyguard during a killed-app SOS, consistent with nothing
-- being sent rather than the push being blocked by the OS.
--
-- Fix: send the standard Supabase webhook payload shape the functions expect.
-- The Vault lookup and Authorization header are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_notify_edge_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'net'
AS $function$
declare
  v_key text;
  v_url text := TG_ARGV[0];
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault — skipping notification call';
    return coalesce(new, old);
  end if;

  perform net.http_post(
    url := v_url,
    -- Was '{}'::jsonb — the bug. The functions require `record`.
    body := jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end,
      'old_record', case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 5000
  );
  return coalesce(new, old);
end;
$function$;
