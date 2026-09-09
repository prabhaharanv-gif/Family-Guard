-- ═══════════════════════════════════════════════════════════════════════════
-- Removing someone from a family actually removes them
-- ═══════════════════════════════════════════════════════════════════════════
--
-- remove_family_member() deleted the family_members row and nothing else, so a
-- removed person stayed attached to the family in every other table:
--
--   locations      — their last position kept being returned for the family, so
--                    they stayed on the map. The client drew them as a pin
--                    labelled "Member", having no member record to name them.
--   device_tokens  — the family's SOS, call and message pushes carried on being
--                    delivered to their phone. Row-level security stops them
--                    READING anything once the membership is gone, but a push
--                    notification is content the app hands them directly, and
--                    nothing was revoking it.
--   device_pings   — Find My Device could still be aimed at them.
--   join_requests  — a stale pending request meant "already requested" if they
--                    ever tried to come back.
--   member_nicknames — private names on both sides outlived the membership.
--
-- The same list leave_family already clears for someone leaving of their own
-- accord; being removed should not leave more behind than walking out does.
--
-- Messages are deliberately left alone, unchanged from before: removing someone
-- is not retracting what they said while they were here.
--
-- The error codes also change, because the originals were never valid. The old
-- body raised `using errcode = 'PGRST301'`, which is eight characters —
-- errcode takes a five-character SQLSTATE or a condition name, so Postgres
-- answered with `42704 unrecognized exception condition "PGRST301"` instead of
-- the message. Anyone who was not an admin got that instead of being told they
-- were not an admin. Now 28000 (invalid_authorization_specification) and 42501
-- (insufficient_privilege), matching what clear_family_chat_for_me uses.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.remove_family_member(p_family_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Cannot remove yourself with this function — use leave_family
  if p_user_id = v_uid then
    raise exception 'Use leave_family to remove yourself' using errcode = '22023';
  end if;

  -- Must be admin
  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can remove members' using errcode = '42501';
  end if;

  -- Cannot remove the family creator/only admin
  if exists (
    select 1 from families where id = p_family_id and created_by = p_user_id
  ) then
    raise exception 'Cannot remove the family owner' using errcode = '22023';
  end if;

  -- ── Cut the ties this family had to them ─────────────────────────────────
  delete from locations
    where family_id = p_family_id and user_id = p_user_id;
  delete from device_tokens
    where family_id = p_family_id and user_id = p_user_id;
  delete from device_pings
    where family_id = p_family_id
      and (target_user_id = p_user_id or sent_by = p_user_id);
  delete from join_requests
    where family_id = p_family_id and requester_id = p_user_id;
  delete from member_nicknames
    where family_id = p_family_id
      and (owner_user_id = p_user_id or target_user_id = p_user_id);

  delete from family_members
  where user_id   = p_user_id
    and family_id = p_family_id;
end;
$function$;

revoke all on function public.remove_family_member(uuid, uuid) from public;
grant execute on function public.remove_family_member(uuid, uuid) to authenticated;
