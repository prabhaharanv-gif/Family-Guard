-- ═══════════════════════════════════════════════════════════════════════════
-- Low-battery and phone-off alerts for the family
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Four things a family wants to know about someone's phone:
--   battery_low       battery fell to 15% or below, not charging
--   battery_critical  battery fell to 5% or below, not charging
--   phone_offline     no location report for 45 minutes (phone off, dead,
--                     or no network), with the last battery level
--   back_online       the phone reports again after a phone_offline alert
--
-- Each is a row in device_alerts; an INSERT trigger posts it to the
-- send-device-alert-notification edge function (same pattern as places).
--
-- Battery alerts come from a trigger on locations that only fires on the
-- crossing (old above the line, new at or below), so they are naturally once
-- per drop, plus a 3-hour cooldown so a level flickering around 15% cannot
-- repeat. A phone that is off cannot report anything, so phone_offline is found
-- by a job every 5 minutes instead. That job stays quiet 23:00–06:00 IST:
-- switching a phone off at night is normal, and anything still silent at 06:00
-- is reported then.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.device_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  family_id     uuid not null,
  kind          text not null check (kind in ('battery_low', 'battery_critical', 'phone_offline', 'back_online')),
  battery_level integer,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists device_alerts_lookup_idx
  on public.device_alerts (user_id, family_id, kind, created_at desc);

alter table public.device_alerts enable row level security;

drop policy if exists "family members read device alerts" on public.device_alerts;
create policy "family members read device alerts" on public.device_alerts
  as PERMISSIVE for SELECT to authenticated
  using (public.is_family_member(family_id));

drop policy if exists "service_role_all_device_alerts" on public.device_alerts;
create policy "service_role_all_device_alerts" on public.device_alerts
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- ── Emitting one alert, with the de-duplication rules in one place ──────────
create or replace function public._device_alert_emit(
  p_user uuid, p_family uuid, p_kind text, p_battery integer, p_last_seen timestamptz
) returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_kind in ('battery_low', 'battery_critical') then
    -- Cooldown: at most one of each kind per 3 hours.
    if exists (
      select 1 from public.device_alerts
       where user_id = p_user and family_id = p_family and kind = p_kind
         and created_at > now() - interval '3 hours'
    ) then return; end if;

  elsif p_kind = 'phone_offline' then
    -- One per silence: not again until the phone has reported since the last one.
    if exists (
      select 1 from public.device_alerts
       where user_id = p_user and family_id = p_family and kind = 'phone_offline'
         and created_at >= p_last_seen
    ) then return; end if;

  elsif p_kind = 'back_online' then
    -- Only as the answer to a phone_offline alert that has not been answered.
    if not exists (
      select 1 from public.device_alerts o
       where o.user_id = p_user and o.family_id = p_family and o.kind = 'phone_offline'
         and not exists (
           select 1 from public.device_alerts b
            where b.user_id = p_user and b.family_id = p_family and b.kind = 'back_online'
              and b.created_at > o.created_at
         )
    ) then return; end if;
  end if;

  insert into public.device_alerts (user_id, family_id, kind, battery_level, last_seen_at)
  values (p_user, p_family, p_kind, p_battery, p_last_seen);
end;
$function$;

revoke execute on function public._device_alert_emit(uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;

-- ── Battery: fires on the crossing only ─────────────────────────────────────
create or replace function public._device_battery_alert()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public._device_alert_emit(
    new.user_id, new.family_id,
    case when new.battery_level <= 5 then 'battery_critical' else 'battery_low' end,
    new.battery_level, new.updated_at
  );
  return new;
end;
$function$;

drop trigger if exists trg_device_battery_alert on public.locations;
create trigger trg_device_battery_alert
  after update on public.locations
  for each row
  when (
    new.is_sharing is not false
    and coalesce(new.is_charging, false) = false
    and new.battery_level is not null and old.battery_level is not null
    and ( (new.battery_level <= 5  and old.battery_level > 5)
       or (new.battery_level <= 15 and old.battery_level > 15) )
  )
  execute function public._device_battery_alert();

-- ── Back online: the first report after a long silence ──────────────────────
create or replace function public._device_back_online()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public._device_alert_emit(new.user_id, new.family_id, 'back_online', new.battery_level, old.updated_at);
  return new;
end;
$function$;

drop trigger if exists trg_device_back_online on public.locations;
create trigger trg_device_back_online
  after update on public.locations
  for each row
  when (old.updated_at < new.updated_at - interval '45 minutes')
  execute function public._device_back_online();

-- ── Phone off / unreachable: found by a periodic check ──────────────────────
create or replace function public.detect_offline_members()
 returns integer
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  n integer := 0;
  v_hour integer := extract(hour from (now() at time zone 'Asia/Kolkata'));
begin
  -- Quiet hours, IST. See the header of this file.
  if v_hour >= 23 or v_hour < 6 then return 0; end if;

  for r in
    select l.user_id, l.family_id, l.battery_level, l.updated_at
      from public.locations l
     where l.is_sharing is not false
       and l.location_enabled is not false           -- GPS switched off is its own, known state
       and l.updated_at < now() - interval '45 minutes'
       and l.updated_at > now() - interval '3 days'  -- long-abandoned accounts stay quiet
       -- Only phones that run the background service. A web-only member reports
       -- only while a tab is open, so silence there means nothing.
       and exists (select 1 from public.device_tokens dt where dt.user_id = l.user_id)
  loop
    perform public._device_alert_emit(r.user_id, r.family_id, 'phone_offline', r.battery_level, r.updated_at);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.detect_offline_members() from public, anon, authenticated;

select cron.schedule('detect_offline_members', '*/5 * * * *', 'select public.detect_offline_members()');

-- ── Push ────────────────────────────────────────────────────────────────────
drop trigger if exists device_alert_notification on public.device_alerts;
create trigger device_alert_notification
  after insert on public.device_alerts
  for each row execute function trg_notify_edge_function(
    'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-device-alert-notification'
  );
