-- ═══════════════════════════════════════════════════════════════════════════
-- A member's mobile number should come from the account they registered with
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Symptom: someone who registered through the OTP flow shows "No number saved"
-- on their family card's call menu, and an empty Mobile Number on Profile,
-- even though they proved ownership of that number by receiving an SMS code.
--
-- Cause: family_members.phone is only ever written by the app, when the person
-- opens Profile and presses Save. Nothing copies the number the account itself
-- was created with, so until somebody re-types it by hand it is null on every
-- membership row — and the call menu reads exactly that column.
--
-- The number is already on the account, in one of two places depending on when
-- the person registered:
--
--   auth.users.phone   set by signInWithOtp/verifyOtp for everyone who has
--                      registered since the OTP flow landed
--   auth.users.email   the older accounts are '91XXXXXXXXXX@familyguard.app',
--                      a synthetic address that encodes the mobile number
--
-- account_phone() reads whichever exists and normalises to the +91XXXXXXXXXX
-- form the app already writes from Profile, so the two paths cannot drift.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.account_phone(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select case
    -- Registered by OTP: Supabase stores E.164 digits, no '+'.
    when u.phone is not null
         and length(regexp_replace(u.phone, '\D', '', 'g')) >= 10
      then '+91' || right(regexp_replace(u.phone, '\D', '', 'g'), 10)
    -- Older account: the number is encoded in the synthetic email.
    when u.email ~ '^91[0-9]{10}@familyguard\.app$'
      then '+91' || substring(u.email from 3 for 10)
    else null
  end
  from auth.users u
  where u.id = p_uid
$function$;

-- Internal only. It is called from the SECURITY DEFINER functions below and by
-- the backfill; no client needs to look up somebody else's account.
revoke all on function public.account_phone(uuid) from public;

-- ── Joining a family ────────────────────────────────────────────────────────
-- Same as 20260831160000 with one more fallback at the end of the chain:
-- another membership row → user_profiles → the account itself.
create or replace function public.accept_join_request(request_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_req join_requests%rowtype;
  v_avatar_url text;
  v_phone      text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_req
  from join_requests
  where id = request_id and status = 'pending';

  if not found then
    raise exception 'Join request not found or already processed' using errcode = 'P0002';
  end if;

  if not is_family_admin(v_req.family_id) then
    raise exception 'Only family admins can accept join requests' using errcode = 'PGRST301';
  end if;

  select
    (array_remove(array_agg(fm.avatar_url order by fm.joined_at desc), null))[1],
    (array_remove(array_agg(fm.phone      order by fm.joined_at desc), null))[1]
  into v_avatar_url, v_phone
  from family_members fm
  where fm.user_id = v_req.requester_id;

  if v_avatar_url is null or v_phone is null then
    select coalesce(v_avatar_url, up.avatar_url), coalesce(v_phone, up.phone)
    into   v_avatar_url, v_phone
    from user_profiles up
    where up.user_id = v_req.requester_id;
  end if;

  -- Nobody has typed a number anywhere: take the one the account was made with.
  if v_phone is null then
    v_phone := account_phone(v_req.requester_id);
  end if;

  insert into family_members (family_id, user_id, display_name, role, avatar_url, phone)
  values (
    v_req.family_id,
    v_req.requester_id,
    coalesce(nullif(trim(v_req.requester_name), ''), 'Family Member'),
    'member',
    v_avatar_url,
    v_phone
  )
  on conflict (user_id, family_id) do nothing;

  update join_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;
end;
$function$;

-- ── Creating a family ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_family_with_membership(p_family_name text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_family families%rowtype;
  v_avatar_url text;
  v_phone      text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_family_name is null or trim(p_family_name) = '' then
    raise exception 'Family name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_family_name) > 100 then
    raise exception 'Family name too long (max 100 chars)' using errcode = '22023';
  end if;
  if p_display_name is null or trim(p_display_name) = '' then
    raise exception 'Display name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_display_name) > 100 then
    raise exception 'Display name too long (max 100 chars)' using errcode = '22023';
  end if;

  select
    (array_remove(array_agg(fm.avatar_url order by fm.joined_at desc), null))[1],
    (array_remove(array_agg(fm.phone      order by fm.joined_at desc), null))[1]
  into v_avatar_url, v_phone
  from family_members fm
  where fm.user_id = v_uid;

  if v_avatar_url is null or v_phone is null then
    select coalesce(v_avatar_url, up.avatar_url), coalesce(v_phone, up.phone)
    into   v_avatar_url, v_phone
    from user_profiles up
    where up.user_id = v_uid;
  end if;

  if v_phone is null then
    v_phone := account_phone(v_uid);
  end if;

  insert into families (name, created_by)
  values (trim(p_family_name), v_uid)
  returning * into v_family;

  insert into family_members (family_id, user_id, display_name, role, avatar_url, phone)
  values (v_family.id, v_uid, trim(p_display_name), 'admin', v_avatar_url, v_phone);

  return jsonb_build_object(
    'id',          v_family.id,
    'name',        v_family.name,
    'invite_code', v_family.invite_code,
    'created_by',  v_family.created_by
  );
end;
$function$;

-- ── Backfill everyone who already joined without a number ───────────────────
-- Only fills nulls; a number somebody typed by hand always wins.
update public.family_members fm
set phone = public.account_phone(fm.user_id)
where fm.phone is null
  and public.account_phone(fm.user_id) is not null;

insert into public.user_profiles (user_id, phone)
select u.id, public.account_phone(u.id)
from auth.users u
where public.account_phone(u.id) is not null
on conflict (user_id) do update
  set phone = coalesce(public.user_profiles.phone, excluded.phone);
