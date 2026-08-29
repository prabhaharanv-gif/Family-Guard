-- ═══════════════════════════════════════════════════════════════════════════
-- Distinguish "sharing turned off" from "phone GPS turned off"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Family list showed only two states: sharing on (green pin) and sharing
-- off (grey pin with a red X). A member who had granted location access but
-- then switched their phone's location services off looked identical to a
-- member who was sharing normally — the pin stayed green and simply went
-- stale, which nobody could interpret.
--
-- locations.location_enabled carries that third state.
--
-- The hard part: when location services are off the device produces no fixes,
-- so it never calls upsert_location_with_battery and can never report the
-- problem through the normal path. Hence set_location_status() below, which
-- writes the flag on its own without needing coordinates.
--
-- It deliberately does NOT touch updated_at. That column means "when this
-- position was measured"; refreshing it here would make a stale pin look
-- freshly located, which is the opposite of what this feature is for.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The flag ─────────────────────────────────────────────────────────────
-- Defaults to true: existing rows are assumed fine and are corrected by the
-- owner's device on its next report, which is the safe direction to be wrong in
-- (a false "GPS off" warning would be more alarming than a missing one).
alter table public.locations
  add column if not exists location_enabled boolean not null default true;

-- ── 2. Report the flag without a fix ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_location_status(p_family_id uuid, p_enabled boolean)
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

  update locations
  set location_enabled = p_enabled
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$;

grant execute on function public.set_location_status(uuid, boolean) to authenticated;

-- ── 3. A successful fix proves location services are on ─────────────────────
-- Same as the 20260829170000 version (still no last_active write — presence is
-- update_member_heartbeat's job) with location_enabled = true added.
CREATE OR REPLACE FUNCTION public.upsert_location_with_battery(p_family_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric DEFAULT 0, p_speed numeric DEFAULT NULL::numeric, p_battery integer DEFAULT NULL::integer, p_is_charging boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO locations (user_id,family_id,lat,lng,accuracy,speed,battery_level,is_charging,is_sharing,location_enabled,updated_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,p_accuracy,p_speed,p_battery,p_is_charging,true,true,v_now)
  ON CONFLICT (user_id,family_id) DO UPDATE SET
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,
    speed=EXCLUDED.speed,battery_level=EXCLUDED.battery_level,
    is_charging=EXCLUDED.is_charging,is_sharing=true,location_enabled=true,updated_at=v_now;
  INSERT INTO location_history (user_id,family_id,lat,lng,recorded_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,v_now);
END;
$function$;
