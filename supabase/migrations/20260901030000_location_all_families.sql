-- ═══════════════════════════════════════════════════════════════════════════
-- A position belongs to the person, not to whichever family is on screen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- useLocationBroadcast is handed a single familyId and writes only that row, so
-- a member of several families reported their position to whichever one their
-- app happened to have active. Every other family kept the last position from
-- the last time THEY were the active one.
--
-- Observed directly on one account in four families, all four with
-- show_location = true:
--
--   Thilaga's Family   05:32   ← active, current
--   Ranjith 's Family  04:53   ← 40 minutes stale
--   Sudha's Family     03:54   ← 1h38m stale
--   Saha Family        —       ← no row at all, joined that morning
--
-- The newest family is the visible symptom — a member who joins and never
-- becomes "active" has no locations row ever created, so their card reads
-- "Waiting" indefinitely with GPS fully on and nothing wrong with their phone.
-- But the stale rows are the worse half: those families are shown a position
-- that is hours old with no indication it is not live.
--
-- Same fix as upsert_device_token_all_families, and the same reasoning: the
-- thing being stored is a property of the device, and scoping the write to one
-- family was never right.
--
-- PRIVACY. Only families with show_location = true are written. A family the
-- member has hidden from is skipped entirely rather than written with
-- is_sharing = false, because not every SELECT policy on locations tests
-- is_sharing — "Family members can view locations" does not — so a row with
-- real coordinates is readable by that family whatever the flag says. Not
-- writing it is the only version that actually withholds anything.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.upsert_location_all_families(
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
    battery_level, is_charging, is_sharing, updated_at
  )
  select v_uid, fm.family_id, p_lat, p_lng, p_accuracy, p_speed,
         p_battery, p_is_charging, true, v_now
  from family_members fm
  where fm.user_id = v_uid
    and fm.show_location is distinct from false
  on conflict (user_id, family_id) do update set
    lat           = excluded.lat,
    lng           = excluded.lng,
    accuracy      = excluded.accuracy,
    speed         = excluded.speed,
    battery_level = excluded.battery_level,
    is_charging   = excluded.is_charging,
    is_sharing    = true,
    updated_at    = v_now;

  get diagnostics v_rows = row_count;

  insert into location_history (user_id, family_id, lat, lng, recorded_at)
  select v_uid, fm.family_id, p_lat, p_lng, v_now
  from family_members fm
  where fm.user_id = v_uid
    and fm.show_location is distinct from false;

  return v_rows;
end;
$function$;

revoke all on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean) from public;
grant execute on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean) to authenticated;
