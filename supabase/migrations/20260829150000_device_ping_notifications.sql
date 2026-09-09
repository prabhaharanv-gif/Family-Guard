-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: "Find My Device" never made a sound or showed a notification
-- ═══════════════════════════════════════════════════════════════════════════
--
-- send_device_ping() inserted a device_pings row correctly, but nothing was
-- ever listening on the other end. Both delivery paths were missing:
--
--   * app killed / backgrounded -> there was NO trigger on device_pings and no
--     edge function, so no FCM push was ever sent. sos_alerts, calls and
--     messages all have this wiring; device_pings was the only alert table
--     without it. This is the path that matters — a phone you are trying to
--     find is by definition not in your hand with the app open.
--
--   * app open -> useDevicePing.js subscribes to device_pings INSERTs over
--     Realtime, but the table was never added to the supabase_realtime
--     publication, so postgres_changes produced no events.
--
-- This migration fixes both, and adds a per-target rate limit: the ping now
-- rings the target's phone at full alarm volume via PingRingService, so an
-- unthrottled RPC is an obvious way to harass a family member.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Rate limit — at most one ping per target per 30 s ────────────────────
-- Checked against the target (not the sender) so two members cannot take turns
-- to ring the same phone continuously.
CREATE OR REPLACE FUNCTION public.send_device_ping(p_family_id uuid, p_target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Sender must be a family member
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  -- Target must be in the SAME family
  if not exists (
    select 1 from family_members
    where user_id   = p_target_user_id
      and family_id = p_family_id
  ) then
    raise exception 'Target user is not in this family' using errcode = 'PGRST116';
  end if;

  -- Cannot ping yourself
  if p_target_user_id = v_uid then
    raise exception 'Cannot ping yourself' using errcode = '22023';
  end if;

  -- Rate limit — the ring lasts 30 s, so anything sooner would only ever
  -- restart a ring already in progress.
  if exists (
    select 1 from device_pings
    where target_user_id = p_target_user_id
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception 'That phone is already ringing — wait a moment before pinging again'
      using errcode = '22023';
  end if;

  -- sent_by forced to auth.uid() — never trusted from client
  insert into device_pings (target_user_id, family_id, sent_by)
  values (p_target_user_id, p_family_id, v_uid);
end;
$function$;

-- ── 2. Push notification trigger — reuses the generic webhook function ──────
drop trigger if exists ping_notification on public.device_pings;
create trigger ping_notification
  AFTER INSERT on public.device_pings
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-ping-notification');

-- ── 3. Realtime — so postgres_changes subscriptions fire for this table ─────
-- Guarded: `alter publication ... add table` errors if the table is already a
-- member, which would abort the whole migration on re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'device_pings'
  ) then
    alter publication supabase_realtime add table public.device_pings;
  end if;
end $$;
