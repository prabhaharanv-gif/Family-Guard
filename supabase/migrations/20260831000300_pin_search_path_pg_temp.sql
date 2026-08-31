-- Pin pg_temp in the search_path of the remaining SECURITY DEFINER functions.
--
-- When pg_temp is not listed explicitly, PostgreSQL searches the session's
-- temporary schema FIRST — ahead of pg_catalog and public — for relation and
-- type names. A SECURITY DEFINER function runs with the owner's privileges, so
-- a caller able to create a temp table named after one of the relations the
-- function touches could shadow it and have the function operate on their
-- table instead. Listing pg_temp last removes that.
--
-- This is defense in depth: DDL is not reachable through PostgREST, so there
-- is no live path to exploit it today. It is also the rule Supabase's own
-- database linter enforces, and the rest of the schema already follows it —
-- these twelve were the stragglers.
--
-- ALTER FUNCTION only changes the search_path setting; no function body is
-- touched and no behaviour changes.

ALTER FUNCTION public.claim_active_device(text, text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.delete_my_account()
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.is_active_device(text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.mark_messages_read(uuid)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.set_member_nickname(uuid, uuid, text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.sync_avatar_all_families(text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.sync_location_sharing_all_families(boolean)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.sync_privacy_all_families(boolean, boolean, boolean)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.sync_profile_all_families(text, text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.update_member_avatar(uuid, text)
  SET search_path TO 'public', 'pg_temp';

-- These two keep the extra schemas they legitimately need; pg_temp goes last
-- so it is searched after them rather than before everything.
ALTER FUNCTION public.reset_password_verified(text)
  SET search_path TO 'public', 'auth', 'pg_temp';

ALTER FUNCTION public.trg_notify_edge_function()
  SET search_path TO 'public', 'vault', 'net', 'pg_temp';
