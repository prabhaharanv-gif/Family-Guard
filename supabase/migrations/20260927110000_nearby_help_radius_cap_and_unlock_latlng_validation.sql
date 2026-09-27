-- Two gaps flagged in a 2026-09-27 external security review:
--
-- 1. list_famora_social_dots took the caller's p_radius_m with no server-side
--    ceiling and returned every matching row with no LIMIT. The app itself
--    always asks for 15000 (NearbySearchMap.jsx), but the function is granted
--    to `authenticated`, so any signed-in account could call it directly with
--    a much larger radius and sweep the whole opted-in user base in one call
--    — exactly the enumeration this function's own comment says fuzzing exists
--    to prevent. Now clamped to the app's own radius, and capped at 300 rows.
--
-- 2. report_unlock_attempts took p_lat/p_lng with no range check, so a bad
--    value (lat outside -90..90, lng outside -180..180) would still be stored
--    and shown to the family. Out-of-range values are now treated the same
--    way (0,0) already was: dropped to null rather than rejected outright, so
--    the alert itself (which matters more than its position) still lands.

create or replace function public.list_famora_social_dots(
  p_center_lat double precision, p_center_lng double precision, p_radius_m double precision default 15000
) RETURNS table(lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    l.lat + (random() - 0.5) * 2 * (400 / 111320.0),
    l.lng + (random() - 0.5) * 2 * (400 / 111320.0 / cos(radians(l.lat)))
  from (
    select distinct on (user_id) user_id, lat, lng
    from public.locations
    where is_sharing = true and lat is not null and lng is not null
      and not (lat = 0 and lng = 0)
      and updated_at > now() - interval '30 minutes'
      and user_id <> auth.uid()
    order by user_id, updated_at desc
  ) l
  join public.user_consents c
    on c.user_id = l.user_id and c.consent_type = 'famora_social_visibility'
  where l.lat between p_center_lat - (least(coalesce(p_radius_m, 15000), 15000) / 111000.0)
                   and p_center_lat + (least(coalesce(p_radius_m, 15000), 15000) / 111000.0)
    and l.lng between p_center_lng - (least(coalesce(p_radius_m, 15000), 15000) / 111000.0 / cos(radians(p_center_lat)))
                   and p_center_lng + (least(coalesce(p_radius_m, 15000), 15000) / 111000.0 / cos(radians(p_center_lat)))
  limit 300;
$function$;

revoke execute on function public.list_famora_social_dots(double precision, double precision, double precision) from public, anon;
grant  execute on function public.list_famora_social_dots(double precision, double precision, double precision) to authenticated, service_role;

create or replace function public.report_unlock_attempts(
  p_attempts integer, p_lat double precision default null, p_lng double precision default null
) returns uuid
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_group uuid := gen_random_uuid();
  v_on    boolean;
  v_lat   double precision;
  v_lng   double precision;
  n       integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select unlock_alert into v_on from public.user_alert_prefs where user_id = v_uid;
  if v_on is not true then return null; end if;

  if exists (select 1 from public.unlock_alerts
              where user_id = v_uid and created_at > now() - interval '10 minutes') then
    return null;
  end if;

  -- A placeholder (0,0) or anything outside a real coordinate range is not a
  -- position worth storing or showing the family; the report itself still goes.
  if p_lat is not null and p_lng is not null
     and not (p_lat = 0 and p_lng = 0)
     and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_lat := p_lat;
    v_lng := p_lng;
  end if;

  insert into public.unlock_alerts (group_id, user_id, family_id, attempts, lat, lng)
  select v_group, v_uid, fm.family_id, greatest(1, least(coalesce(p_attempts, 3), 99)), v_lat, v_lng
    from public.family_members fm where fm.user_id = v_uid;
  get diagnostics n = row_count;
  if n = 0 then return null; end if;
  return v_group;
end;
$function$;

revoke execute on function public.report_unlock_attempts(integer, double precision, double precision) from public, anon;
grant  execute on function public.report_unlock_attempts(integer, double precision, double precision) to authenticated, service_role;
