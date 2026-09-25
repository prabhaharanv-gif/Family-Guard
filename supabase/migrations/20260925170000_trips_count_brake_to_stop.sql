-- ===========================================================================
-- Driving trips: count a hard brake that ends in a stop
-- ===========================================================================
--
-- The first version only looked at fixes at 8 km/h or faster, so a brake all
-- the way down to a stop, the hardest kind, was never counted: the fix that
-- showed the stop was skipped. The trigger now also fires when the PREVIOUS fix
-- was moving, and the function ignores a slow fix unless a trip is already open.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

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
  -- decides whether it was long enough to keep).
  if found and new.updated_at - t.ended_at > interval '5 minutes' then
    update public.trips set is_open = false where id = t.id;
    t := null;
  end if;

  -- A slow fix only matters as the end of a trip that is already open.
  if t.id is null and new.speed < 8 then return new; end if;

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
    and (new.speed >= 8 or coalesce(old.speed, 0) >= 8)
  )
  execute function public._trip_track();

notify pgrst, 'reload schema';
