-- ===========================================================================
-- Overspeed alert (Profile -> Safety)
-- ===========================================================================
--
-- A person opts in and picks their own limit (km/h). While they are driving
-- faster than that, the family is told, using the same device_alerts table and
-- push path as the battery and phone-off alerts.
--
-- Off unless chosen: overspeed_limit_kmh is null until the person turns it on.
--
-- Detection is a trigger on locations. The phone pushes a fix every few seconds
-- while moving, so requiring TWO consecutive fixes at or over the limit (with
-- the second no more than 2 minutes after the first) filters out a single GPS
-- speed spike without needing any state. At most one alert per person and
-- family every 30 minutes, so a long fast drive is one alert, not hundreds.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

alter table public.user_alert_prefs
  add column if not exists overspeed_limit_kmh integer;

alter table public.user_alert_prefs
  drop constraint if exists user_alert_prefs_overspeed_range;
alter table public.user_alert_prefs
  add constraint user_alert_prefs_overspeed_range
  check (overspeed_limit_kmh is null or overspeed_limit_kmh between 30 and 200);

alter table public.device_alerts add column if not exists speed_kmh integer;
alter table public.device_alerts add column if not exists limit_kmh integer;

alter table public.device_alerts drop constraint if exists device_alerts_kind_check;
alter table public.device_alerts add constraint device_alerts_kind_check
  check (kind in ('battery_low', 'battery_critical', 'phone_offline', 'back_online', 'overspeed'));

create or replace function public._overspeed_alert()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit integer;
begin
  select overspeed_limit_kmh into v_limit
    from public.user_alert_prefs where user_id = new.user_id;
  if v_limit is null then return new; end if;

  -- Both this fix and the one before it at or over the limit, close in time.
  if new.speed < v_limit or old.speed < v_limit then return new; end if;
  if new.speed > 250 then return new; end if;
  if new.updated_at - old.updated_at > interval '2 minutes' then return new; end if;

  -- Cooldown: one per person and family every 30 minutes.
  if exists (
    select 1 from public.device_alerts
     where user_id = new.user_id and family_id = new.family_id and kind = 'overspeed'
       and created_at > now() - interval '30 minutes'
  ) then return new; end if;

  insert into public.device_alerts (user_id, family_id, kind, speed_kmh, limit_kmh)
  values (new.user_id, new.family_id, 'overspeed', round(new.speed)::integer, v_limit);
  return new;
end;
$function$;

revoke execute on function public._overspeed_alert() from public, anon, authenticated;

drop trigger if exists trg_overspeed_alert on public.locations;
create trigger trg_overspeed_alert
  after update on public.locations
  for each row
  when (
    new.is_sharing is not false
    and new.speed is not null and old.speed is not null
    and new.speed >= 30 and old.speed >= 30
  )
  execute function public._overspeed_alert();

notify pgrst, 'reload schema';
