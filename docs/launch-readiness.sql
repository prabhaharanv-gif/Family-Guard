-- Launch readiness: run in the Supabase SQL Editor. READ-ONLY, changes nothing.
--
-- Checks the parts of the backend the app depends on that the older drift check
-- does not: tables and RLS, columns, triggers, cron jobs, storage buckets,
-- extensions, the Vault secret (name only, never its value), and who may run
-- the internal functions. Run docs/migration-drift-check.sql as well, for
-- functions.
--
-- The first row is a summary. Every row after it is a PROBLEM. If only the
-- summary row appears, everything checked is in place.
-- (No apostrophes in comments: the editor splits statements naively.)

with checks(kind, name, ok) as (

  -- tables the recent features need
  select 'table missing', t, to_regclass('public.' || t) is not null
  from unnest(array[
    'user_alert_prefs','places','place_events','nearby_help_escalations',
    'nearby_help_notifications','device_alerts','lost_phone',
    'place_weather_alerts','sos_media','trips','unlock_alerts'
  ]) as t

  union all
  -- row level security must be on for each of them
  select 'RLS off', c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('user_alert_prefs','places','place_events','nearby_help_escalations',
      'nearby_help_notifications','device_alerts','lost_phone','place_weather_alerts',
      'sos_media','trips','unlock_alerts')

  union all
  -- columns the app reads or writes
  select 'column missing', c, exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = split_part(c, '.', 2)
      and table_name = split_part(c, '.', 1))
  from unnest(array[
    'sos_alerts.sos_group_id','user_alert_prefs.overspeed_limit_kmh',
    'user_alert_prefs.driving_trips','user_alert_prefs.unlock_alert',
    'user_alert_prefs.allow_lost_mode','device_alerts.speed_kmh','device_alerts.limit_kmh'
  ]) as c

  union all
  select 'column missing (any table)', c, exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = c)
  from unnest(array['hidden_by_helper','hidden_by_requester']) as c

  union all
  -- triggers that turn a row into a push notification or a state change
  select 'trigger missing', t, exists (
    select 1 from pg_trigger g where g.tgname = t and not g.tgisinternal)
  from unnest(array[
    'device_alert_notification','lost_phone_notification','nearby_help_notify_tier',
    'nearby_help_status_change','place_notification','trg_device_back_online',
    'trg_device_battery_alert','trg_overspeed_alert','trg_start_nearby_help_escalation',
    'trg_trip_track','unlock_alert_notification'
  ]) as t

  union all
  -- scheduled jobs, and they must be switched on
  select 'cron job missing or inactive', j, exists (
    select 1 from cron.job where jobname = j and active)
  from unnest(array[
    'close_stale_trips','detect_offline_members','expire_lost_phone',
    'nearby_help_cron_cleanup','place_weather_check','purge_expired_sos_media',
    'purge_expired_unlock_alerts','purge_old_trips','purge_place_weather_alerts'
  ]) as j

  union all
  -- private storage buckets
  select 'bucket missing or public', b, exists (
    select 1 from storage.buckets where id = b and public = false)
  from unnest(array['sos-media','unlock-photos']) as b

  union all
  select 'extension missing', e, exists (select 1 from pg_extension where extname = e)
  from unnest(array['pg_cron','pg_net','supabase_vault']) as e

  union all
  -- the key the notification triggers use; only its existence is checked
  select 'vault secret missing', 'service_role_key',
    exists (select 1 from vault.secrets where name = 'service_role_key')

  union all
  -- registration guard: must exist and be callable by signed-in users only
  select 'registration guard missing or wrong grants', 'registration_number_taken()',
    to_regprocedure('public.registration_number_taken()') is not null
    and has_function_privilege('authenticated', 'public.registration_number_taken()', 'execute')
    and not has_function_privilege('anon', 'public.registration_number_taken()', 'execute')

  union all
  -- pre-OTP registration lookup: must exist and be callable by the server role ONLY
  select 'phone_registered missing or open to app users', 'phone_registered(text)',
    to_regprocedure('public.phone_registered(text)') is not null
    and has_function_privilege('service_role', 'public.phone_registered(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.phone_registered(text)', 'execute')
    and not has_function_privilege('anon', 'public.phone_registered(text)', 'execute')

  union all
  -- internal functions signed-in users must NOT be able to run
  select 'internal function open to signed-in users', p.oid::regprocedure::text,
    not has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'find_nearest_opted_in_users','advance_nearby_help_tier',
      '_nearby_help_notify_tier','_nearby_help_safe_unschedule',
      'change_member_role','clear_family_messages','set_location_sharing',
      'update_member_privacy','update_member_profile')

  union all
  -- functions that a migration dropped and that must be gone
  select 'dropped function still live', p.oid::regprocedure::text, false
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_debug_nearby_help'
)
select 0 as sort, 'SUMMARY' as kind,
       count(*) || ' checks run, ' || count(*) filter (where not ok) || ' problems' as name
from checks
union all
select 1, kind, name from checks where not ok
order by sort, kind, name;
