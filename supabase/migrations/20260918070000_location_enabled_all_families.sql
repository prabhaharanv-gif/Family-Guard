-- ===========================================================================
-- A landed fix clears "No GPS" in EVERY family, not just the active one
--
-- Reported 2026-09-18: a member showed "No GPS" on the family card while her
-- pin kept moving — her distance changed between two screenshots.
--
-- location_enabled is written per family row. The native service reports it
-- only for the family in its prefs (set_location_status), and
-- upsert_location_with_battery sets it true for that one family on a
-- successful fix. But the in-app writer used by a member in several families,
-- upsert_location_all_families, never touched the column at all.
--
-- So: her phone once had location off, which wrote false to the family that
-- was active on her phone. Turning location back on reported true to whichever
-- family was active then, and every OTHER family kept false forever, while
-- their rows went on receiving fresh positions from the all-families writer.
--
-- A position that arrives IS proof that location services are on, which is
-- exactly the reasoning upsert_location_with_battery already used. This adds
-- the same to the all-families writer.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.upsert_location_all_families(
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric default 0,
  p_speed       numeric default null,
  p_battery     integer default null,
  p_is_charging boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid  uuid        := auth.uid();
  v_now  timestamptz := now();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into locations (
    user_id, family_id, lat, lng, accuracy, speed,
    battery_level, is_charging, is_sharing, location_enabled, updated_at
  )
  select v_uid, fm.family_id, p_lat, p_lng, p_accuracy, p_speed,
         p_battery, p_is_charging, true, true, v_now
  from family_members fm
  where fm.user_id = v_uid
    and fm.show_location is distinct from false
  on conflict (user_id, family_id) do update set
    lat              = excluded.lat,
    lng              = excluded.lng,
    accuracy         = excluded.accuracy,
    speed            = excluded.speed,
    battery_level    = excluded.battery_level,
    is_charging      = excluded.is_charging,
    is_sharing       = true,
    -- The fix itself is the proof; a stale false here is what showed a moving
    -- member as No GPS.
    location_enabled = true,
    updated_at       = v_now;

  get diagnostics v_rows = row_count;

  insert into location_history (user_id, family_id, lat, lng, recorded_at)
  select v_uid, fm.family_id, p_lat, p_lng, v_now
  from family_members fm
  where fm.user_id = v_uid
    and fm.show_location is distinct from false;

  return v_rows;
end;
$function$;

revoke execute on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean) from public, anon;
grant  execute on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean) to authenticated, service_role;

-- ── One-off repair: clear the stale flag where a recent position exists ─────
-- A position in the last hour cannot have come from a phone with location off.
update locations
set location_enabled = true
where location_enabled = false
  and updated_at > now() - interval '1 hour'
  and (lat <> 0 or lng <> 0);
