-- ═══════════════════════════════════════════════════════════════════════════
-- leave_family — the function the Leave Family button has always called
-- ═══════════════════════════════════════════════════════════════════════════
--
-- authStore.leaveFamily() calls rpc('leave_family', { p_family_id }), and
-- remove_family_member() tells admins to "Use leave_family to remove yourself"
-- — but nothing ever created it, so the button failed with
--
--     Could not find the function public.leave_family(p_family_id)
--     in the schema cache
--
-- Doing this server-side rather than letting the client delete its own
-- family_members row is the same reasoning as remove_family_member: the rules
-- about who may leave, and what happens to a family whose owner walks out, are
-- not things a client can be trusted to apply.
--
-- Ownership follows the policy delete_my_account already uses, rather than
-- inventing a second one: the owner leaving hands the family to another member
-- and makes them an admin, and an owner leaving a family with nobody else in it
-- takes the family and its data with them. Blocking the owner outright was the
-- alternative, but this project has no transfer-ownership screen, so that would
-- have made "Leave" permanently impossible for whoever created the family.
--
-- Messages are deliberately left alone. Leaving a room is not the same as
-- retracting what you said in it, and remove_family_member does not delete a
-- removed member's messages either. What IS removed is everything that would
-- keep the family connected to you afterwards: your location, the push tokens
-- they could reach you on, pings, any pending join request, and the nicknames
-- either side had set.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.leave_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid       uuid := auth.uid();
  v_successor uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from family_members
    where family_id = p_family_id and user_id = v_uid
  ) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  -- ── The owner walking out ────────────────────────────────────────────────
  if exists (
    select 1 from families where id = p_family_id and created_by = v_uid
  ) then
    select user_id into v_successor
    from family_members
    where family_id = p_family_id
      and user_id  <> v_uid
    order by joined_at
    limit 1;

    if v_successor is not null then
      -- Longest-standing remaining member takes over, so the family always has
      -- someone who can admit and remove people.
      update families
        set created_by = v_successor
      where id = p_family_id;

      update family_members
        set role = 'admin'
      where family_id = p_family_id and user_id = v_successor;
    else
      -- Nobody left to own it. Same teardown as delete_my_account performs for
      -- a family whose last member is going.
      delete from sos_alerts       where family_id = p_family_id;
      delete from messages         where family_id = p_family_id;
      delete from message_reads    where family_id = p_family_id;
      delete from locations        where family_id = p_family_id;
      delete from device_tokens    where family_id = p_family_id;
      delete from device_pings     where family_id = p_family_id;
      delete from join_requests    where family_id = p_family_id;
      delete from member_nicknames where family_id = p_family_id;
      delete from family_members   where family_id = p_family_id;
      delete from families         where id = p_family_id;
      return;
    end if;
  end if;

  -- ── Cut the ties this family had to you ──────────────────────────────────
  delete from locations
    where family_id = p_family_id and user_id = v_uid;
  delete from device_tokens
    where family_id = p_family_id and user_id = v_uid;
  delete from device_pings
    where family_id = p_family_id and (target_user_id = v_uid or sent_by = v_uid);
  delete from join_requests
    where family_id = p_family_id and requester_id = v_uid;
  delete from member_nicknames
    where family_id = p_family_id and (owner_user_id = v_uid or target_user_id = v_uid);

  delete from family_members
    where family_id = p_family_id and user_id = v_uid;
end;
$function$;

revoke all on function public.leave_family(uuid) from public;
grant execute on function public.leave_family(uuid) to authenticated;
