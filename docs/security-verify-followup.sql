-- Follow-up verification: run in the Supabase SQL Editor. Read-only, changes
-- nothing. Checks the specific items the 2026-09-28 audit could not confirm
-- from the repo alone: whether past revoke-execute migrations actually
-- applied, whether the internal underscore-prefixed helpers are closed to
-- clients, whether the cron jobs the app depends on are registered, and the
-- help_kind column drift flagged separately. Empty groups are the goal.
-- (No apostrophes in comments: the editor splits statements naively.)

-- family_joined_at is a deliberate third exception, same reason as the other
-- two: the messages RLS policy is declared "to public" and calls it, so an
-- anon caller needs execute or the read errors instead of returning zero rows
-- (see 20260918140000_messages_from_join_onwards.sql).
select 'A. callable by anon (expect only is_family_member/is_family_admin/family_joined_at)' as check_name,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in ('is_family_member', 'is_family_admin', 'family_joined_at')

union all

select 'B. underscore-prefixed internal helper callable by authenticated (expect none)',
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like '\_%'
  and has_function_privilege('authenticated', p.oid, 'execute')

union all

-- Named check on the specific functions the 2026-09-25 sweep meant to close.
select 'C. should be service_role-only but is authenticated-executable',
       f.n
from unnest(array[
  'find_nearest_opted_in_users', 'advance_nearby_help_tier',
  '_nearby_help_notify_tier', '_nearby_help_safe_unschedule',
  'phone_registered'
]) as f(n)
where exists (
  select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = f.n
    and has_function_privilege('authenticated', p.oid, 'execute')
)

union all

-- Cron jobs the app depends on for correctness (not security by itself, but
-- a silently-missing job means a feature is quietly not running at all).
select 'D. expected cron job missing',
       j.n
from unnest(array[
  'close_stale_trips', 'purge_old_trips', 'detect_offline_members',
  'expire_lost_phone', 'place_weather_check', 'purge_place_weather_alerts',
  'nearby_help_cron_cleanup', 'purge_expired_sos_media', 'purge_expired_unlock_alerts',
  'retention_job_1', 'retention_job_2', 'retention_job_3', 'retention_job_4', 'retention_job_5'
]) as j(n)
where not exists (select 1 from cron.job where jobname = j.n)

union all

select 'E. column drift (20260924130000 references it, no migration creates it)',
       'nearby_help_escalations.help_kind: ' ||
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'nearby_help_escalations'
            and column_name = 'help_kind'
       ) then 'present' else 'MISSING' end

order by 1, 2;
