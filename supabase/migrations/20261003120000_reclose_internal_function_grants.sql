-- =========================================================================
-- Re-close internal function grants (regression found 2026-10-03)
-- =========================================================================
--
-- A live run of docs/security-verify-followup.sql on 2026-10-03 showed signed-in
-- users could execute functions that earlier migrations had already closed:
-- find_nearest_opted_in_users, advance_nearby_help_tier, _nearby_help_notify_tier,
-- _nearby_help_safe_unschedule, phone_registered, _can_manage_lost_phone and
-- _device_alert_emit. The live grants no longer match the repo, so something
-- re-granted them after the earlier fixes (a restore, a re-created function, or
-- a blanket grant run by hand).
--
-- Every function below is reached only from security definer functions, triggers
-- or pg_cron jobs, all of which run with the owner rights, or from an edge
-- function using the service role. None is called by the app. Removing client
-- access therefore changes nothing for the app.
--
-- Deliberately NOT touched: is_family_member, is_family_admin, family_joined_at,
-- can_view_sos_media and can_view_unlock_photo (row level security policies call
-- them as the signed-in user) and every RPC the app calls.
--
-- Safe to run twice. Loops over every overload by name. Functions that no longer
-- exist (for example close_stale_trips after the trips removal) are skipped.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer, so the block uses a named tag.
-- =========================================================================

do $reclose$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'find_nearest_opted_in_users',
         'advance_nearby_help_tier',
         '_nearby_help_notify_tier',
         '_nearby_help_safe_unschedule',
         'phone_registered',
         '_can_manage_lost_phone',
         '_device_alert_emit',
         'detect_offline_members',
         'purge_expired_sos_media',
         'purge_expired_unlock_alerts',
         'mark_dead_sessions_signed_out',
         'run_place_weather_check',
         'close_stale_trips'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$reclose$;
