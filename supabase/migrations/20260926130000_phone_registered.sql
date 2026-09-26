-- =========================================================================
-- phone_registered(): is this number already a completed Famora account?
-- =========================================================================
--
-- Used ONLY by the check-registration edge function, so that Create Account
-- can warn BEFORE an SMS code is sent instead of after it is verified.
--
-- Telling a stranger whether a number has an account lets anyone test lists of
-- numbers, so this is not callable by app users at all: execute is granted to
-- service_role only. The edge function is the only door, and it answers only
-- when the request carries a valid CAPTCHA token.
--
-- A number counts as registered when an account carries it (phone column, or
-- the older email form) AND has a password. A row with no password is only an
-- abandoned sign-up: sending the code created it, and the person never
-- finished. That number is free to register.
--
-- Returns only true or false. No apostrophes in comments: the dashboard SQL
-- Editor splits statements naively, so the body uses a named tag.
-- =========================================================================

create or replace function public.phone_registered(p_digits text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $fn$
  select exists (
    select 1 from auth.users u
     where coalesce(u.encrypted_password, '') <> ''
       and (
         regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g')
         or lower(coalesce(u.email, '')) = regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g') || '@familyguard.app'
       )
       and regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g') <> ''
  );
$fn$;

-- Every role is refused first, including the ones Supabase grants by default
-- to new functions, then only the server role is let back in.
revoke all on function public.phone_registered(text) from public, anon, authenticated;
grant execute on function public.phone_registered(text) to service_role;
