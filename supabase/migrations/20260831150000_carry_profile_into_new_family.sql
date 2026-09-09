-- Carry a person's existing profile into the family they join.
--
-- accept_join_request inserted only (family_id, user_id, display_name, role),
-- so every other column on the new row started null — including avatar_url and
-- phone. The effect is that somebody who has already set a profile picture
-- appears to the new family as a bare letter avatar, and their number shows
-- nowhere, even though both are sitting on their membership row in another
-- family. Nothing ever backfilled it either: avatars only propagate when
-- sync_avatar_all_families runs, which happens on upload, so a photo set
-- BEFORE joining stayed invisible until the person happened to re-upload it.
--
-- The profile belongs to the person, not to one membership, so the join should
-- carry it across. Values are read from any other row the same user already
-- has; when there is none (a first-ever family) they are simply null, exactly
-- as before.
--
-- Deliberately NOT carried: role (always 'member' — a family owner elsewhere
-- must not arrive as an admin here) and the privacy toggles, which stay null
-- so the app's own per-family defaults apply, matching how ProfilePage already
-- seeds them from a sibling row.
--
-- Everything else in the function is unchanged from the baseline.
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

  -- Verify admin of the target family
  if not is_family_admin(v_req.family_id) then
    raise exception 'Only family admins can accept join requests' using errcode = 'PGRST301';
  end if;

  -- Whatever this person already filled in elsewhere. Newest membership wins
  -- when they belong to several, and each column is taken independently so a
  -- row carrying only one of the two still contributes it.
  select
    (array_remove(array_agg(fm.avatar_url order by fm.joined_at desc), null))[1],
    (array_remove(array_agg(fm.phone      order by fm.joined_at desc), null))[1]
  into v_avatar_url, v_phone
  from family_members fm
  where fm.user_id = v_req.requester_id;

  -- Insert member atomically (duplicate is silently ignored)
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

-- Backfill the members who already joined before the above existed, so
-- existing families do not stay stuck with blank avatars until each person
-- re-uploads. Only fills nulls; never overwrites a value already set.
update family_members target
set avatar_url = coalesce(target.avatar_url, src.avatar_url),
    phone      = coalesce(target.phone,      src.phone)
from (
  select
    user_id,
    (array_remove(array_agg(avatar_url order by joined_at desc), null))[1] as avatar_url,
    (array_remove(array_agg(phone      order by joined_at desc), null))[1] as phone
  from family_members
  group by user_id
) src
where target.user_id = src.user_id
  and (target.avatar_url is null or target.phone is null)
  and (src.avatar_url is not null or src.phone is not null);
