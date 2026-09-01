-- ═══════════════════════════════════════════════════════════════════════════
-- The profile picture belongs to the person, not to one membership row
-- ═══════════════════════════════════════════════════════════════════════════
--
-- avatar_url has only ever lived on family_members, one copy per membership.
-- Every writer works around that: sync_avatar_all_families fans the URL out
-- across the rows that exist, and 20260831150000 taught accept_join_request to
-- copy it from a sibling row when somebody joins their second family.
--
-- Both share one blind spot — a user with NO membership row anywhere. That is
-- the ordinary path for a new account: register, set a profile picture, then
-- ask to join a family. sync_avatar_all_families updates zero rows, so the URL
-- is stored nowhere, and accept_join_request then has no sibling row to copy
-- from. The new member arrives as a bare letter avatar and stays that way
-- until they happen to re-upload the same photo. The person who CREATED the
-- family never sees this, because their membership row was made first by
-- create_family_with_membership and their upload had somewhere to land — which
-- is exactly the asymmetry reported.
--
-- user_profiles gives the photo a home that does not depend on belonging to a
-- family. family_members.avatar_url stays as it is and remains what the app
-- reads: this is the source the copies are made from, not a replacement for
-- them, so nothing that already works has to change.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.user_profiles (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  avatar_url text,
  phone      text,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Readable by yourself and by anyone who shares a family with you — the same
-- audience that can already see the identical URL on your family_members row.
--
-- is_family_member() is SECURITY DEFINER, so the membership test does not
-- re-enter the family_members policies from inside this one.
drop policy if exists "read own or family member profile" on public.user_profiles;
create policy "read own or family member profile" on public.user_profiles
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.family_members f
      where f.user_id = user_profiles.user_id
        and is_family_member(f.family_id)
    )
  );

-- Writes are your own row only. The RPCs below are SECURITY DEFINER and force
-- auth.uid(), so this policy covers the direct-PostgREST path.
drop policy if exists "write own profile" on public.user_profiles;
create policy "write own profile" on public.user_profiles
  for all
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Uploading a photo now always records it, membership or not ──────────────
CREATE OR REPLACE FUNCTION public.sync_avatar_all_families(p_avatar_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.family_members
     set avatar_url = p_avatar_url
   where user_id = v_uid;

  -- The part that was missing: with no membership row the update above is a
  -- no-op and the photo was simply forgotten.
  insert into public.user_profiles (user_id, avatar_url)
  values (v_uid, p_avatar_url)
  on conflict (user_id) do update
    set avatar_url = excluded.avatar_url,
        updated_at = now();
end;
$function$;

-- Same treatment for name and phone, so a number entered before joining
-- survives the join as well.
CREATE OR REPLACE FUNCTION public.sync_profile_all_families(p_display_name text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.family_members
     set display_name = p_display_name,
         phone        = p_phone
   where user_id = v_uid;

  insert into public.user_profiles (user_id, phone)
  values (v_uid, p_phone)
  on conflict (user_id) do update
    set phone      = excluded.phone,
        updated_at = now();
end;
$function$;

-- ── Joining a family picks the photo up from either place ───────────────────
-- Unchanged from 20260831150000 except that user_profiles is consulted when no
-- sibling membership row carries a value.
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

  -- Fall back to the standalone profile — the only place a first-time joiner's
  -- photo can be.
  if v_avatar_url is null or v_phone is null then
    select coalesce(v_avatar_url, up.avatar_url), coalesce(v_phone, up.phone)
    into   v_avatar_url, v_phone
    from user_profiles up
    where up.user_id = v_req.requester_id;
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

-- ── Creating a family carries the profile too ───────────────────────────────
-- Somebody who sets a photo and then creates their own family hits exactly the
-- same hole as the joiner: the membership row is inserted with four columns.
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

-- ── Seed user_profiles from what memberships already hold ───────────────────
-- So the table is not empty for everybody who set a photo before today.
insert into public.user_profiles (user_id, avatar_url, phone)
select
  user_id,
  (array_remove(array_agg(avatar_url order by joined_at desc), null))[1],
  (array_remove(array_agg(phone      order by joined_at desc), null))[1]
from public.family_members
group by user_id
on conflict (user_id) do update
  set avatar_url = coalesce(public.user_profiles.avatar_url, excluded.avatar_url),
      phone      = coalesce(public.user_profiles.phone,      excluded.phone);

-- And the reverse: a membership row missing a photo the profile knows about.
update public.family_members fm
set avatar_url = coalesce(fm.avatar_url, up.avatar_url),
    phone      = coalesce(fm.phone,      up.phone)
from public.user_profiles up
where up.user_id = fm.user_id
  and (fm.avatar_url is null or fm.phone is null)
  and (up.avatar_url is not null or up.phone is not null);
