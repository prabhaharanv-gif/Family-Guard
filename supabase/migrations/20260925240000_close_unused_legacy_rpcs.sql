-- =========================================================================
-- Close five unused legacy functions to app users
-- =========================================================================
--
-- change_member_role, clear_family_messages, set_location_sharing,
-- update_member_privacy and update_member_profile date from the first schema
-- snapshot. The app replaced them with the all-families variants and never
-- calls them: a search of every commit since the repository began (source and
-- native code), the edge functions and the migrations finds no caller, and no
-- other database function calls them either.
--
-- They were checked in the August audit and do enforce who may call them, but
-- an unused entry point is attack surface for no benefit, and
-- change_member_role can promote a member to admin.
--
-- Written as a loop over every overload by name. service_role keeps execute.
-- To undo, grant execute on the function to authenticated again.
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
         'change_member_role',
         'clear_family_messages',
         'set_location_sharing',
         'update_member_privacy',
         'update_member_profile'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
  end loop;
end
$rv$;

notify pgrst, 'reload schema';
