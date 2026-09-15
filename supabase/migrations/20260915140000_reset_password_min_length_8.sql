-- ===========================================================================
-- Password minimum length: 6 to 8, on the server as well
--
-- The app now refuses breached passwords (src/lib/leakedPassword.js), and every
-- 6-digit number is in the Have I Been Pwned list: 60 of 60 sampled, each seen
-- hundreds of times. With a 6-character minimum the app kept inviting a
-- password it would then always refuse, so the minimum is now 8 everywhere
-- (src/lib/passwordPolicy.js).
--
-- reset_password_verified writes auth.users directly, so neither the Supabase
-- Auth minimum length setting nor its leaked password switch applies to it.
-- Its own length check is the only server-side rule on that path.
--
-- The body is unchanged from 20260901040000_reset_password_finds_otp_accounts
-- apart from the number. Existing 6 and 7 character passwords keep working for
-- sign-in; the rule only applies when a password is set.
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
  if length(p_new_password) < 8 then
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

-- create or replace keeps existing grants, so authenticated can still call it
-- and anon still cannot. Check (should return: authenticated true, anon false):
-- select has_function_privilege('authenticated', 'public.reset_password_verified(text)', 'execute') as authenticated,
--        has_function_privilege('anon', 'public.reset_password_verified(text)', 'execute') as anon;
