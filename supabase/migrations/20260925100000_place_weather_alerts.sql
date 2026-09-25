-- ===========================================================================
-- Severe-weather alerts for saved Places
-- ===========================================================================
--
-- Every 30 minutes the check-place-weather edge function reads the forecast for
-- each saved place (Home, Office...) and, if something severe is due in the next
-- 12 hours, records a row here and pushes the place owner. Only the owner is
-- told: places are private to their owner.
--
-- Kinds: thunderstorm, heavy_rain, heat, wind.
-- This table is also the cooldown: at most one alert per place and kind every
-- 12 hours, enforced by the function reading it.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create table if not exists public.place_weather_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  place_id   uuid references public.places(id) on delete cascade,
  place_name text not null,
  kind       text not null check (kind in ('thunderstorm', 'heavy_rain', 'heat', 'wind')),
  starts_at  timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists place_weather_alerts_lookup_idx
  on public.place_weather_alerts (place_id, kind, created_at desc);

alter table public.place_weather_alerts enable row level security;

drop policy if exists "owner reads own weather alerts" on public.place_weather_alerts;
create policy "owner reads own weather alerts" on public.place_weather_alerts
  as PERMISSIVE for SELECT to authenticated
  using (user_id = auth.uid());

drop policy if exists "service_role_all_place_weather_alerts" on public.place_weather_alerts;
create policy "service_role_all_place_weather_alerts" on public.place_weather_alerts
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- ── The 30 minute job: call the edge function with the Vault service key ────
create or replace function public.run_place_weather_check()
 returns void
 language plpgsql security definer set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault - skipping weather check';
    return;
  end if;
  perform net.http_post(
    url := 'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/check-place-weather',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 20000
  );
end;
$function$;

revoke execute on function public.run_place_weather_check() from public, anon, authenticated;

select cron.schedule('place_weather_check', '*/30 * * * *', 'select public.run_place_weather_check()');

-- Old alerts are only needed for the cooldown.
select cron.schedule('purge_place_weather_alerts', '45 3 * * *',
  $cron$delete from public.place_weather_alerts where created_at < now() - interval '3 days'$cron$);

notify pgrst, 'reload schema';
