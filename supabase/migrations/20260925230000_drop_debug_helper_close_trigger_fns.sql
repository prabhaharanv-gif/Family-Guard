-- =========================================================================
-- Drop the leftover debug helper, close the trigger functions
-- =========================================================================
--
-- 1. _debug_nearby_help was a temporary diagnostic (migration 20260923160000)
--    granted to signed-in users, with no ownership check, returning the raw
--    escalation row and the candidate helper ids for any escalation id it is
--    given. Its drop migration (20260923170000) never reached the live
--    database: a security sweep on 2026-09-25 still found it. Dropped here.
--
-- 2. Three trigger functions carry the default execute grant for signed-in
--    users. They return trigger, so they cannot be called as a normal
--    function, but there is no reason for the grant. Triggers do not check
--    the execute privilege when they fire, so they keep working.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer, so the block uses a named tag.
-- =========================================================================

drop function if exists public._debug_nearby_help(uuid, double precision);

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
         '_device_back_online',
         '_device_battery_alert',
         '_start_nearby_help_escalation'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$rv$;

notify pgrst, 'reload schema';
