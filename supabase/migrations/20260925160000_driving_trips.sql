-- ===========================================================================
-- Driving trips (Profile -> Safety -> Driving trips)
-- ===========================================================================
--
-- A person opts in; from then on each drive is recorded as one trip row that
-- the whole family can read: when, how far, how long, average and top speed,
-- and how many hard brakes and hard accelerations.
--
-- Nothing new is collected from the phone. A trigger on locations watches the
-- fixes the phone already sends while it is moving (5 to 10 seconds apart) and
-- folds each one into the open trip. A trip ends when no moving fix has
-- arrived for 5 minutes; a cron job closes it and throws away trips under
-- 500 m or 90 seconds, so walks and GPS drift never appear.
--
-- Hard brake: speed fell by 2.8 m/s per second or more between two fixes no
-- more than 10 seconds apart. Hard acceleration: rose by 2.5 m/s per second.
--
-- Off unless chosen (driving_trips false). Turning it off deletes the person
-- own trips from the app. Trips older than 30 days are purged.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

alter table public.user_alert_prefs
  add column if not exists driving_trips boolean not null default false;

create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  family_id    uuid not null,
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  last_lat     double precision,
  last_lng     double precision,
  distance_m   double precision not null default 0,
  top_kmh      integer not null default 0,
  hard_brakes  integer not null default 0,
  hard_accels  integer not null default 0,
  is_open      boolean not null default true
);

create unique index if not exists trips_one_open_idx
  on public.trips (user_id, family_id) where is_open;
create index if not exists trips_family_idx
  on public.trips (family_id, started_at desc);

alter table public.trips enable row level security;

drop policy if exists "family members read trips" on public.trips;
create policy "family members read trips" on public.trips
  as PERMISSIVE for SELECT to authenticated
  using (public.is_family_member(family_id));

drop policy if exists "owner deletes own trips" on public.trips;
create policy "owner deletes own trips" on public.trips
  as PERMISSIVE for DELETE to authenticated
  using (user_id = auth.uid());

drop policy if exists "service_role_all_trips" on public.trips;
create policy "service_role_all_trips" on public.trips
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- Great-circle distance in metres.
create or replace function public._haversine_m(lat1 double precision, lng1 double precision,
                                                lat2 double precision, lng2 double precision)
 returns double precision
 language sql immutable
as $function$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$function$;

-- Fold one moving fix into the open trip, or start a trip.
create or replace function public._trip_track()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_on boolean;
  t public.trips%rowtype;
  dt double precision;
  step double precision;
  dv double precision;
begin
  select driving_trips into v_on from public.user_alert_prefs where user_id = new.user_id;
  if v_on is not true then return new; end if;
  if new.lat is null or new.lng is null or (new.lat = 0 and new.lng = 0) then return new; end if;

  select * into t from public.trips
   where user_id = new.user_id and family_id = new.family_id and is_open;

  -- A stale open trip belongs to an earlier drive: close it (the cron job
  -- decides whether it was long enough to keep) and start a new one.
  if found and new.updated_at - t.ended_at > interval '5 minutes' then
    update public.trips set is_open = false where id = t.id;
    t := null;
  end if;

  if t.id is null then
    insert into public.trips (user_id, family_id, started_at, ended_at, last_lat, last_lng, top_kmh)
    values (new.user_id, new.family_id, new.updated_at, new.updated_at, new.lat, new.lng, round(new.speed)::integer);
    return new;
  end if;

  dt := extract(epoch from (new.updated_at - t.ended_at));
  if dt <= 0 then return new; end if;

  step := public._haversine_m(t.last_lat, t.last_lng, new.lat, new.lng);
  -- A position jump faster than 70 m/s is a bad fix, not driving.
  if step / dt > 70 then step := 0; end if;

  dv := 0;
  if old.speed is not null and dt <= 10 then
    dv := (new.speed - old.speed) / 3.6 / dt;
  end if;

  update public.trips set
    ended_at    = new.updated_at,
    last_lat    = new.lat,
    last_lng    = new.lng,
    distance_m  = distance_m + step,
    top_kmh     = greatest(top_kmh, round(new.speed)::integer),
    hard_brakes = hard_brakes + case when dv <= -2.8 then 1 else 0 end,
    hard_accels = hard_accels + case when dv >= 2.5 then 1 else 0 end
  where id = t.id;
  return new;
end;
$function$;

revoke execute on function public._trip_track() from public, anon, authenticated;

drop trigger if exists trg_trip_track on public.locations;
create trigger trg_trip_track
  after update on public.locations
  for each row
  when (
    new.is_sharing is not false
    and new.speed is not null
    and new.speed >= 8
  )
  execute function public._trip_track();

-- Every 5 minutes: close trips that have gone quiet, drop the too-short ones.
create or replace function public.close_stale_trips()
 returns integer
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
begin
  update public.trips set is_open = false
   where is_open and ended_at < now() - interval '5 minutes';
  get diagnostics n = row_count;

  delete from public.trips
   where not is_open
     and (distance_m < 500 or ended_at - started_at < interval '90 seconds');
  return n;
end;
$function$;

revoke execute on function public.close_stale_trips() from public, anon, authenticated;

select cron.schedule('close_stale_trips', '*/5 * * * *', 'select public.close_stale_trips()');
select cron.schedule('purge_old_trips', '50 3 * * *',
  $cron$delete from public.trips where started_at < now() - interval '30 days'$cron$);

notify pgrst, 'reload schema';
