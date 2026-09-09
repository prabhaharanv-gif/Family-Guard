-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: members stayed "Online" long after closing the app
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Root cause: presence was inferred from family_members.last_active, but
-- upsert_location_with_battery() ended with
--
--     UPDATE family_members SET last_active = v_now ...
--
-- and that RPC is what LocationForegroundService posts to every 90 s from the
-- BACKGROUND. The service is declared stopWithTask="false" and reschedules
-- itself from onTaskRemoved(), so it keeps running after the app is closed or
-- swiped away — refreshing last_active forever. With the UI treating "active
-- within 2 minutes" as online, a member showed Online for as long as their
-- phone was switched on, whether or not the app had ever been reopened.
--
-- The two facts were conflated: "this device still reports its location" is
-- not "this person has the app open". This migration separates them.
--
--   * last_active  keeps its honest meaning — when the app was last open.
--     It stays the source for "last seen X ago".
--   * is_online    is an explicit flag, set true by the foreground heartbeat
--     and false the moment the app is backgrounded, closed or swiped away.
--
-- The client requires BOTH (is_online AND a fresh last_active), so a process
-- killed hard enough to never send the offline signal still ages out instead
-- of being stuck Online forever.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Explicit presence flag ───────────────────────────────────────────────
-- Defaults to false: every existing row starts offline and is corrected by the
-- owner's next heartbeat, which is the safe direction to be wrong in.
alter table public.family_members
  add column if not exists is_online boolean not null default false;

-- ── 2. Heartbeat marks the member present ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_member_heartbeat(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not is_family_member(p_family_id) then return; end if;

  update family_members
  set last_active = now(),
      is_online   = true
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$;

-- ── 3. Explicit offline signal ──────────────────────────────────────────────
-- Deliberately does NOT touch last_active: the member is no longer online, but
-- "last seen" should still read the moment they actually left, not the moment
-- the signal happened to arrive.
CREATE OR REPLACE FUNCTION public.set_member_offline(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not is_family_member(p_family_id) then return; end if;

  update family_members
  set is_online = false
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$;

grant execute on function public.set_member_offline(uuid) to authenticated;

-- ── 4. THE core fix — background location no longer implies presence ────────
-- Identical to the previous definition except the trailing
-- `UPDATE family_members SET last_active = v_now` is gone. Foreground presence
-- is already covered by update_member_heartbeat(), which the app calls on its
-- own interval while open, so nothing loses freshness by removing it here.
CREATE OR REPLACE FUNCTION public.upsert_location_with_battery(p_family_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric DEFAULT 0, p_speed numeric DEFAULT NULL::numeric, p_battery integer DEFAULT NULL::integer, p_is_charging boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO locations (user_id,family_id,lat,lng,accuracy,speed,battery_level,is_charging,is_sharing,updated_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,p_accuracy,p_speed,p_battery,p_is_charging,true,v_now)
  ON CONFLICT (user_id,family_id) DO UPDATE SET
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,
    speed=EXCLUDED.speed,battery_level=EXCLUDED.battery_level,
    is_charging=EXCLUDED.is_charging,is_sharing=true,updated_at=v_now;
  INSERT INTO location_history (user_id,family_id,lat,lng,recorded_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,v_now);
END;
$function$;
