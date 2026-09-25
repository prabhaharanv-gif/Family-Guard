-- ===========================================================================
-- Signal strength on the family card
--
-- Each phone reports its network with every position: Wi-Fi, or mobile data
-- with a 0 to 4 bar level. Shown next to battery so the family can tell that a
-- member who is not answering, or whose pin is old, is somewhere with no signal.
--
-- signal_at is its own timestamp on purpose. A phone that loses signal cannot
-- report that it lost it, so the last value it managed to send is always a
-- GOOD one. The card greys the icon out once signal_at is a few minutes old
-- rather than showing a confident full bars from the past.
--
-- Only the native all-families writer sends it (it is the one writer on
-- Android). Calls without the new parameters, from older app builds or the web,
-- leave the stored signal untouched instead of wiping it.
--
-- The old six-argument function is dropped first: keeping it beside the new one
-- would give PostgREST two candidates for the same call and it refuses to pick.
-- Old builds still work, because the new parameters have defaults.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

begin;

alter table public.locations
  add column if not exists signal_level smallint,
  add column if not exists network_type text,
  add column if not exists signal_at    timestamptz;

alter table public.locations drop constraint if exists locations_signal_level_range;
alter table public.locations
  add constraint locations_signal_level_range
  check (signal_level is null or signal_level between 0 and 4);

alter table public.locations drop constraint if exists locations_network_type_values;
alter table public.locations
  add constraint locations_network_type_values
  check (network_type is null or network_type in ('wifi', 'cellular'));

drop function if exists public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean);

create function public.upsert_location_all_families(
  p_lat          numeric,
  p_lng          numeric,
  p_accuracy     numeric  default 0,
  p_speed        numeric  default null,
  p_battery      integer  default null,
  p_is_charging  boolean  default false,
  p_signal_level smallint default null,
  p_network_type text     default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid     uuid        := auth.uid();
  v_now     timestamptz := now();
  v_rows    integer;
  v_has_sig boolean     := p_network_type is not null;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into locations (
    user_id, family_id, lat, lng, accuracy, speed,
    battery_level, is_charging, is_sharing, location_enabled, updated_at,
    signal_level, network_type, signal_at
  )
  select v_uid, fm.family_id, p_lat, p_lng, p_accuracy, p_speed,
         p_battery, p_is_charging, true, true, v_now,
         case when v_has_sig then p_signal_level end,
         case when v_has_sig then p_network_type end,
         case when v_has_sig then v_now end
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
    location_enabled = true,
    updated_at       = v_now,
    -- Only overwritten when this call carried a reading.
    signal_level     = case when v_has_sig then excluded.signal_level else locations.signal_level end,
    network_type     = case when v_has_sig then excluded.network_type else locations.network_type end,
    signal_at        = case when v_has_sig then v_now                 else locations.signal_at    end;

  get diagnostics v_rows = row_count;

  insert into location_history (user_id, family_id, lat, lng, recorded_at)
  select v_uid, fm.family_id, p_lat, p_lng, v_now
  from family_members fm
  where fm.user_id = v_uid
    and fm.show_location is distinct from false;

  return v_rows;
end;
$function$;

revoke execute on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean, smallint, text) from public, anon;
grant  execute on function public.upsert_location_all_families(numeric, numeric, numeric, numeric, integer, boolean, smallint, text) to authenticated, service_role;

-- Tell PostgREST about the new signature straight away.
notify pgrst, 'reload schema';

commit;
