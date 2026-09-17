-- ===========================================================================
-- Restore the account phone fallback when joining or creating a family
--
-- Reported 2026-09-17: the call menu on a family card said "No number saved"
-- for some members and not others.
--
-- 20260831220000_carry_account_phone gave accept_join_request and
-- create_family_with_membership a last fallback, account_phone(), so a member
-- with no number on another membership or in user_profiles still got the
-- number their account was registered with. 20260910120000 rewrote both
-- functions for the display_name change from an older copy and silently
-- dropped that fallback, and 20260917130000 inherited the gap. Every
-- membership created since 2026-09-10 without a number elsewhere got a null
-- phone.
--
-- This is 20260917130000 (typed name wins) with the fallback put back, plus
-- the same null-only backfill 20260831220000 ran.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- ── Joining: the requested name wins ────────────────────────────────────────
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

  if v_avatar_url is null or v_phone is null then
    select coalesce(v_avatar_url, up.avatar_url), coalesce(v_phone, up.phone)
    into   v_avatar_url, v_phone
    from user_profiles up
    where up.user_id = v_req.requester_id;
  end if;

  -- Last resort: the number the account was registered with.
  if v_phone is null then
    v_phone := account_phone(v_req.requester_id);
  end if;

  -- What they typed on the request, else the name they already go by, else
  -- the generic label.
  v_name := coalesce(
    nullif(trim(v_req.requester_name), ''),
    existing_display_name(v_req.requester_id),
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

-- ── Creating: the typed name wins ───────────────────────────────────────────
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

  -- Last resort: the number the account was registered with.
  if v_phone is null then
    v_phone := account_phone(v_uid);
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), existing_display_name(v_uid));

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

-- ── Backfill memberships that were created without a number ────────────────
-- Only fills nulls; a number somebody typed in Profile always wins.
update public.family_members fm
set phone = public.account_phone(fm.user_id)
where fm.phone is null
  and public.account_phone(fm.user_id) is not null;
