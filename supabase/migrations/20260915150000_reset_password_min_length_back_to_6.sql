-- ===========================================================================
-- Password minimum length: back to 6
--
-- Reverts 20260915140000_reset_password_min_length_8. The 8 character minimum
-- came with a leaked password check, and together they refused nearly every
-- password family members could remember (every 6 digit number, and most
-- 8 digit date patterns, are in the Have I Been Pwned list). The decision was
-- to allow a 6 digit PIN again and drop the check. The app side lives in
-- src/lib/passwordPolicy.js.
--
-- The body is unchanged from 20260901040000_reset_password_finds_otp_accounts.
--
-- Comments here avoid apostrophes on purpose: the dashboard SQL Editor splits
-- statements with a naive tokenizer that a stray quote in a comment confuses.
-- ===========================================================================

create or replace function public.reset_password_verified(p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_phone  text := auth.jwt()->>'phone';
  v_digits text;
  v_email  text;
  v_uid    uuid;
begin
  if v_phone is null or v_phone = '' then
    raise exception 'Phone verification required';
  end if;
  if length(p_new_password) < 6 then
    raise exception 'Password too short';
  end if;

  v_digits := regexp_replace(v_phone, '^\+', '');
  v_email  := v_digits || '@familyguard.app';

  select id into v_uid
  from auth.users
  where phone = v_digits
     or phone = '+' || v_digits
     or email = v_email
  order by created_at desc
  limit 1;

  if v_uid is null then
    raise exception 'No account found for this verified phone number';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf'))
  where id = v_uid;
end;
$function$;

-- Check (run separately; expect min_is_6 true, authenticated true, anon false):
-- select p.prosrc like '%length(p_new_password) < 6%' as min_is_6,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_call,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_call
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'reset_password_verified';
