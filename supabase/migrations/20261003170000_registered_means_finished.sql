-- ===========================================================================
-- Registered means a finished registration, not just a password
-- ===========================================================================
--
-- phone_registered() and registration_number_taken() decided that a number
-- was already registered when its account had a password. That assumed an
-- account created by sending the SMS code has none. It does have one: a number
-- that has only been sent a code already shows a non-empty encrypted_password.
--
-- So the check after the code is verified refused every brand-new number as
-- already taken, and a number that was merely texted counted as registered for
-- the next attempt. Seen on 2026-10-03: accounts with a password, no display
-- name and no family, blocking their own number.
--
-- A finished registration always sets a display name (the app writes it with
-- the password) and then creates a family, so an account counts as registered
-- only when it has a password AND a display name or a family. An abandoned
-- sign-up has neither and is free to register again.
--
-- Proving the SMS code still proves the person owns the number, so an
-- abandoned account has nothing worth protecting from the next owner of it.
--
-- CREATE OR REPLACE keeps the existing grants on both functions.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer, so the bodies use a named tag.
-- ===========================================================================

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
         (u.raw_user_meta_data ->> 'display_name') is not null
         or exists (select 1 from public.family_members fm where fm.user_id = u.id)
       )
       and (
         regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g')
         or lower(coalesce(u.email, '')) = regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g') || '@familyguard.app'
       )
       and regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g') <> ''
  );
$fn$;

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
         and (
           (u.raw_user_meta_data ->> 'display_name') is not null
           or exists (select 1 from public.family_members fm where fm.user_id = u.id)
         )
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

notify pgrst, 'reload schema';
