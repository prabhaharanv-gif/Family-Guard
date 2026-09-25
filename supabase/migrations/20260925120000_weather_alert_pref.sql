-- ===========================================================================
-- On/off switch for severe-weather alerts (Profile -> Safety)
-- ===========================================================================
--
-- One row per person who has ever touched the switch. No row means ON: the
-- alerts are a safety feature, so silence has to be a choice. The
-- check-place-weather edge function skips anyone whose row says off.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create table if not exists public.user_alert_prefs (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  weather_alerts boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table public.user_alert_prefs enable row level security;

drop policy if exists "owner reads own alert prefs" on public.user_alert_prefs;
create policy "owner reads own alert prefs" on public.user_alert_prefs
  as PERMISSIVE for SELECT to authenticated
  using (user_id = auth.uid());

drop policy if exists "owner inserts own alert prefs" on public.user_alert_prefs;
create policy "owner inserts own alert prefs" on public.user_alert_prefs
  as PERMISSIVE for INSERT to authenticated
  with check (user_id = auth.uid());

drop policy if exists "owner updates own alert prefs" on public.user_alert_prefs;
create policy "owner updates own alert prefs" on public.user_alert_prefs
  as PERMISSIVE for UPDATE to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "service_role_all_user_alert_prefs" on public.user_alert_prefs;
create policy "service_role_all_user_alert_prefs" on public.user_alert_prefs
  as PERMISSIVE for ALL to service_role using (true) with check (true);

notify pgrst, 'reload schema';
