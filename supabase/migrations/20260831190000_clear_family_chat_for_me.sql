-- ═══════════════════════════════════════════════════════════════════════════
-- Clear Chat in the family room clears it for YOU
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The button ran `delete from messages where family_id = ...` straight from the
-- client, so one person tidying their own screen wiped the family's history off
-- everybody's phone, permanently. In a shared room that is not a housekeeping
-- action, it is destroying other people's messages.
--
-- Clearing now hides: it records every message currently in the room in
-- hidden_messages for the caller, which is the same mechanism "Delete for me"
-- on a single message already uses. Messages sent AFTER the clear are not
-- hidden — the room carries on, it is only the backlog that goes.
--
-- The private one-to-one threads deliberately keep the old behaviour: there,
-- Clear Chat removes the conversation for both participants (clear_direct_thread),
-- which is what a two-person thread means by clearing.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.clear_family_chat_for_me(p_family_id uuid)
returns setof uuid
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
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  insert into hidden_messages (user_id, message_id, kind)
  select v_uid, m.id, 'family'
  from messages m
  where m.family_id = p_family_id
  on conflict (user_id, message_id, kind) do nothing;

  -- The ids come back so the caller can hide them immediately instead of
  -- re-reading the whole hidden set. Every message in the room is returned,
  -- not just the newly-inserted ones, so a partially-cleared room still ends
  -- up fully hidden on screen.
  return query
  select m.id from messages m where m.family_id = p_family_id;
end;
$function$;

revoke all on function public.clear_family_chat_for_me(uuid) from public;
grant execute on function public.clear_family_chat_for_me(uuid) to authenticated;

-- ── Close the door the old button went through ──────────────────────────────
-- This policy let ANY family member DELETE ANY message in the family, which is
-- what made the client-side bulk delete work at all. It also sat beside
-- "member deletes own or admin clears family", and because permissive policies
-- are OR-ed, the narrower rule never had any effect.
--
-- Removing it leaves: you may delete your own message (which is what "Delete"
-- on your own bubble does, for everyone), and a family admin may still clear
-- the room outright if they genuinely need to.
drop policy if exists "Family members can delete messages" on public.messages;
