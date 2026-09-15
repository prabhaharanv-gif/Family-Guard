-- ===========================================================================
-- Supabase security lints, 2026-09-15
--
-- NOTE: this file deliberately contains no apostrophes in comments and no
-- comments inside the DO block. The dashboard SQL Editor splits statements
-- with a naive tokenizer, and a stray quote in a comment made it cut the DO
-- block in half ("unterminated dollar-quoted string").
--
-- 1. anon_security_definer_function_executable (62 warnings)
--
--    Every SECURITY DEFINER function in public was callable with just the anon
--    key. Earlier migrations tried to close this with
--      revoke all on function ... from public
--    but Supabase default privileges grant EXECUTE to anon BY NAME, not via
--    PUBLIC, so revoking from PUBLIC never touched it. The functions all check
--    auth.uid() and bail, so nothing was exploitable today, but one future
--    function that forgets that check would be wide open.
--
--    Fix: revoke from anon and PUBLIC on every definer function, re-grant to
--    authenticated explicitly (PUBLIC is gone, so do not rely on it), and
--    change default privileges so new functions are not anon-executable.
--
--    Two deliberate exceptions keep anon EXECUTE: is_family_member() and
--    is_family_admin(). RLS policies declared "to public" call them, and RLS
--    runs as the caller, so revoking would turn an anon read of families,
--    messages or sos_alerts from 0 rows into a permission error. For anon,
--    auth.uid() is null, so both can only ever return false.
--
-- 2. authenticated_security_definer_function_executable (63 warnings)
--
--    Mostly BY DESIGN: these functions ARE the app API (clients are not
--    allowed to write tables directly). Only the ones no client should call
--    lose authenticated EXECUTE:
--      - trigger functions (trg_*): EXECUTE is checked at CREATE TRIGGER, not
--        when the trigger fires, so revoking does not stop them firing
--      - account_phone(uuid): returns the phone number of ANY user
--      - existing_display_name(uuid): returns the display name of ANY user
--      - log_audit_event(...): lets a client forge audit_log rows
--    All three are only called from other SECURITY DEFINER functions, which
--    run as the owner and are unaffected.
--
-- 3. public_bucket_allows_listing (avatars)
--
--    Two broad SELECT policies let anyone list the whole bucket, and every
--    folder name is a user id. A public bucket does not need SELECT for
--    /object/public/ URLs (which is what getPublicUrl() returns). Upload uses
--    upsert: true, which DOES need SELECT on the object being replaced, so
--    they are replaced with an owner-scoped read.
-- ===========================================================================

-- 1 + 2: function privileges
do $grants$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn,
           p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    if r.is_trigger then
      execute format('revoke execute on function %s from authenticated', r.fn);
    else
      execute format('grant execute on function %s to authenticated', r.fn);
    end if;
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end
$grants$;

-- Helpers that RLS evaluates as the caller, including anon. See header.
grant execute on function public.is_family_member(uuid) to anon;
grant execute on function public.is_family_admin(uuid)  to anon;

-- Internal only. See header.
revoke execute on function public.account_phone(uuid)                     from authenticated;
revoke execute on function public.existing_display_name(uuid)             from authenticated;
revoke execute on function public.log_audit_event(text, text, uuid, uuid) from authenticated;

-- Functions created later: not executable by anon unless granted on purpose.
-- The global form is needed for PUBLIC, because an IN SCHEMA default cannot
-- revoke a global default.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 3: avatars bucket listing
drop policy if exists "Public avatar access" on storage.objects;
drop policy if exists "avatars public read"  on storage.objects;

drop policy if exists "avatars owner read" on storage.objects;
create policy "avatars owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Verify (run separately; each should return 0 rows)
-- select p.oid::regprocedure
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef
--   and has_function_privilege('anon', p.oid, 'execute')
--   and p.proname not in ('is_family_member', 'is_family_admin');
--
-- select policyname from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and cmd = 'SELECT' and qual = '(bucket_id = ''avatars''::text)';
