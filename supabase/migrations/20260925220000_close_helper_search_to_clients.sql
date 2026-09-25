-- =========================================================================
-- Close the Nearby Help internals to app users
-- =========================================================================
--
-- find_nearest_opted_in_users is documented as never callable by clients:
-- repeated radius searches from different points would let anyone locate the
-- members who opted in. It never carried a revoke, and Supabase grants
-- execute to signed-in users by default on new functions, so any account
-- could call it. A live permission check on 2026-09-25 showed signed-in users
-- could execute it (anon could not).
--
-- The same gap applies to three internal helpers of the escalation machinery:
-- advance_nearby_help_tier, _nearby_help_notify_tier and
-- _nearby_help_safe_unschedule (which cancels a scheduled job by name).
--
-- None of them is called by the app or an edge function. They are reached only
-- from security definer functions and from pg_cron jobs, which run with the
-- owner rights, so removing client access changes nothing for Nearby Help.
--
-- Written as a loop over every overload by name, so an older signature left
-- behind by an earlier fix is closed too. service_role keeps execute.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer, so the block uses a named tag.
-- =========================================================================

do $rv$
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
         '_nearby_help_safe_unschedule'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
  end loop;
end
$rv$;

notify pgrst, 'reload schema';
