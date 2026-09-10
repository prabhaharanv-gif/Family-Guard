-- One person, one name, across every family they belong to.
--
-- family_members holds a display_name per (user_id, family_id) row, and until
-- now each row took whatever was typed at the moment it was created:
-- create_family_with_membership used its p_display_name argument, and
-- accept_join_request used the requester_name from the join request. Type
-- "Prabhakar" when you create your own family and "Prabha" when you ask to join
-- your sister's, and you are two different people in one app — the family card
-- shows a different name depending on which family is open.
--
-- This is the same hole that 20260831150000 and 20260831160000 closed for
-- avatar_url and phone, which are already carried from an existing membership
-- row (most recently joined first) or from user_profiles. display_name was left
-- out of both, and it is the one people actually notice.
--
-- So: an existing name wins over a newly typed one. The argument is kept as the
-- fallback for a first-ever membership, where there is nothing to carry.
--
-- Deliberately NOT touched: per-viewer nicknames. Somebody who wants to see a
-- relative under a different name still can — nicknames are private to the
-- person who sets them and live client-side, which is the right place for
-- "what I call you" as opposed to "who you are".

-- ── Existing name, most recent membership first ─────────────────────────────
-- Its own function so both call sites cannot drift, and so the ordering rule
-- lives in one place: joined_at desc, matching how avatar_url and phone are
-- already resolved a few lines below each call.
CREATE OR REPLACE FUNCTION public.existing_display_name(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (array_remove(array_agg(fm.display_name order by fm.joined_at desc), null))[1]
  from family_members fm
  where fm.user_id = p_user_id
    and nullif(trim(fm.display_name), '') is not null;
$function$;

-- ── Joining a family keeps the name you already had ─────────────────────────
CREATE OR REPLACE FUNCTION public.accept_join_request(request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req         join_requests%rowtype;
  v_avatar_url  text;
  v_phone       text;
  v_name        text;
begin
  select * into v_req from join_requests where id = request_id and status = 'pending';
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

  -- The name they already go by, else what they typed on the request, else the
  -- generic label the previous version used.
  v_name := coalesce(
    existing_display_name(v_req.requester_id),
    nullif(trim(v_req.requester_name), ''),
    'Family Member'
  );

  insert into family_members (family_id, user_id, display_name, role, avatar_url, phone)
  values (v_req.family_id, v_req.requester_id, v_name, 'member', v_avatar_url, v_phone)
  on conflict (user_id, family_id) do nothing;

  update join_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;
end;
$function$;

-- ── Creating a family keeps it too ──────────────────────────────────────────
-- p_display_name is still validated exactly as before. Someone with no existing
-- membership is still named by it; someone who has one is not renamed by it.
CREATE OR REPLACE FUNCTION public.create_family_with_membership(p_family_name text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_family     families%rowtype;
  v_avatar_url text;
  v_phone      text;
  v_name       text;
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

  v_name := coalesce(existing_display_name(v_uid), trim(p_display_name));

  insert into families (name, created_by)
  values (trim(p_family_name), v_uid)
  returning * into v_family;

  insert into family_members (family_id, user_id, display_name, role, avatar_url, phone)
  values (v_family.id, v_uid, v_name, 'admin', v_avatar_url, v_phone);

  return jsonb_build_object(
    'id',          v_family.id,
    'name',        v_family.name,
    'invite_code', v_family.invite_code,
    'created_by',  v_family.created_by
  );
end;
$function$;

grant execute on function public.existing_display_name(uuid) to authenticated;

-- ── Existing rows are NOT repaired here, on purpose ─────────────────────────
-- A blanket UPDATE would have to choose which of someone's names is the real
-- one, and picking the most recent row would be a guess made on their behalf,
-- in production, silently. There is already a safe way to do it that the person
-- controls: saving a name in Profile calls sync_profile_all_families, which
-- writes every one of their rows at once. One save per affected person fixes
-- them, visibly and by their own choice.
--
-- If you do repair rows by hand, scope every write with family_id as well as
-- user_id. A user_id-only PATCH on this table hits every family that person
-- belongs to — that is exactly how three rows were flattened to one name on
-- 2026-09-10.
