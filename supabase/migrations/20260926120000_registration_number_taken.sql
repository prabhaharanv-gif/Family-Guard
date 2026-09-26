-- =========================================================================
-- registration_number_taken(): stop a number that already has an account
-- from being registered again
-- =========================================================================
--
-- Registration sends an OTP, then verifyOtp signs the person in. For a number
-- that already has an account that signs in the EXISTING user, and the app
-- then set a new password on it. The app tried to catch this by looking for a
-- display_name in the user metadata, which misses two cases:
--
--   1. An existing account whose metadata has no display_name: its password
--      was overwritten without a word.
--   2. An older account registered by email (91XXXXXXXXXX@familyguard.app,
--      phone column empty): verifyOtp creates a SECOND account for the same
--      number, so one person ends up with two.
--
-- This function answers from the database itself. It takes no argument: the
-- number is read from the caller own verified session, so it can only ever
-- speak about a number the caller has just proved they own, and it cannot be
-- used to probe whether other numbers are registered.
--
-- True when either:
--   a) the caller row already has a password set, meaning registration was
--      completed before (a brand new OTP account has none yet), or
--   b) a different account already carries this number, in the phone column
--      or as the older email form.
--
-- Callable by signed-in users only. No apostrophes in comments: the dashboard
-- SQL Editor splits statements naively, so the body uses a named tag.
-- =========================================================================

create or replace function public.registration_number_taken()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $fn$
  with me as (
    select regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g') as digits
  )
  select
    exists (
      select 1 from auth.users u
       where u.id = auth.uid()
         and coalesce(u.encrypted_password, '') <> ''
    )
    or exists (
      select 1 from auth.users u, me
       where me.digits <> ''
         and u.id <> auth.uid()
         and (
           regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = me.digits
           or lower(coalesce(u.email, '')) = me.digits || '@familyguard.app'
         )
    );
$fn$;

revoke all on function public.registration_number_taken() from public, anon;
grant execute on function public.registration_number_taken() to authenticated, service_role;
