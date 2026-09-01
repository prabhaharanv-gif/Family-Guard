-- ═══════════════════════════════════════════════════════════════════════════
-- Password reset must find accounts that registered by phone
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Symptom: "Could not reset: No account found for this verified phone number",
-- raised for a number whose account plainly exists — it is in a family, and it
-- still rings when called.
--
-- reset_password_verified resolved the account by SYNTHETIC EMAIL only:
--
--   v_email := regexp_replace(v_phone, '^\+', '') || '@familyguard.app';
--   select id into v_uid from auth.users where email = v_email;
--
-- That address is real for accounts made before the OTP flow. It does not
-- exist for accounts made since. RegisterPage creates the user with
-- verifyOtp({ phone }) and only then calls updateUser({ email, password }) —
-- and an email CHANGE has to be confirmed, while @familyguard.app has no inbox
-- to confirm from. So the password is set but auth.users.email stays null and
-- the number lives in auth.users.phone instead. The two eras are visible side
-- by side:
--
--   2026-08-24  email=919500564855@familyguard.app  phone=null
--   2026-09-01  email=null                          phone=918148957083
--
-- Every account in the second group was locked out of both password login and
-- password reset. It stayed hidden because a session that never expires never
-- asks anyone to log in — it only surfaced when one was signed out.
--
-- The lookup now accepts either identifier. Note auth.users.phone is stored
-- WITHOUT the leading '+' ('918148957083'), while the JWT claim may carry it,
-- so the '+' is stripped before comparing rather than assumed absent.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Either era. Newest wins if a number somehow has both, which happens when
  -- someone registered again through the OTP flow after an older email-era
  -- account already existed for the same number.
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
