-- is_active_device must not answer "no" to an unauthenticated caller.
--
-- The original returned a plain boolean:
--
--     select exists (
--       select 1 from public.user_active_device
--       where user_id = auth.uid() and device_id = p_device_id
--     );
--
-- When auth.uid() is NULL the comparison matches nothing and the function
-- returns `false` — confidently, with no error. The client cannot tell that
-- apart from "another device claimed the session", so it signs the user out
-- and tells them their account was opened elsewhere, which never happened.
--
-- auth.uid() is NULL more often than it looks. supabase-js falls back to the
-- anon key when it has no session (_getAccessToken returns
-- `sessionToken ?? supabaseKey`), so the request still authenticates — as
-- `anon`. Any momentary gap in the session therefore produced a confident
-- `false` instead of an error.
--
-- claim_active_device already raises in this situation. This brings
-- is_active_device in line, so an unauthenticated check surfaces as an error
-- and every caller fails open, as the single-device design intends.
create or replace function public.is_active_device(p_device_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return exists (
    select 1 from public.user_active_device
    where user_id = v_uid
      and device_id = p_device_id
  );
end;
$$;

revoke all on function public.is_active_device(text) from public;
grant execute on function public.is_active_device(text) to authenticated;
