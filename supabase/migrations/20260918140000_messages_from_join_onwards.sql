-- ===========================================================================
-- A new member sees the conversation from the day they joined, not before it
--
-- Reported 2026-09-18: join a family and the whole history is there. Everything
-- the family said before that person existed to the group -- arguments, an
-- address, a photo of a child -- is handed to them on their first screen. The
-- read policy only ever asked "are you in this family", never "were you in it
-- when this was said".
--
-- The cutoff is family_members.joined_at, which every row already carries.
-- Rows predating that column can be null, and those are read as no cutoff at
-- all: an existing member must not lose history because of this change.
--
-- Enforced in the policy rather than in the query, so it holds for the realtime
-- stream and for anything else that reads the table. The client needs no
-- change.
--
-- Leaving and rejoining sets joined_at again, so a member who left in March and
-- came back in September starts from September. That is the same rule, not a
-- special case, and it is the safer of the two readings.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

-- ── When did I join this family? ────────────────────────────────────────────
-- SECURITY DEFINER for the same reason is_family_member is: a policy on
-- messages that reads family_members directly would run that read through
-- family_members own policies, and those are what recursion lives in.
--
-- min() because a member should never be cut off by a duplicate row created
-- later; the earliest join is the honest answer.
create or replace function public.family_joined_at(fid uuid)
returns timestamptz
language sql
stable
security definer
set search_path to public, pg_temp
as $function$
  select min(joined_at)
  from family_members
  where family_id = fid
    and user_id   = auth.uid()
$function$;

revoke all on function public.family_joined_at(uuid) from public;
grant execute on function public.family_joined_at(uuid) to authenticated;
-- The policy below is declared "to public" and RLS runs as the caller, so
-- without this an anon read of messages would fail outright instead of
-- returning no rows. auth.uid() is null for anon, so this can only return
-- null for them. Same exception is_family_member already has.
grant execute on function public.family_joined_at(uuid) to anon;

-- ── The read policy ─────────────────────────────────────────────────────────
drop policy if exists "members read own family messages" on public.messages;

create policy "members read own family messages" on public.messages
  as PERMISSIVE for SELECT to public
  using (
    is_family_member(family_id)
    and created_at >= coalesce(family_joined_at(family_id), '-infinity'::timestamptz)
  );

-- ── Read receipts stop at the same line ─────────────────────────────────────
-- This runs as definer, so it never saw the policy above. Without the same
-- cutoff a new member is recorded as having read every message in the family
-- history, and "Message Info" on a two-year-old message would list someone who
-- joined last week and cannot open it.
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_joined timestamptz;
begin
  -- Must be a member of the family. Kept as its own EXISTS: min() over no
  -- rows still returns one row, so FOUND would never catch a non-member.
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this family';
  end if;

  select min(joined_at) into v_joined
  from public.family_members
  where family_id = p_family_id and user_id = auth.uid();

  insert into public.message_reads (message_id, user_id, family_id, read_at)
  select m.id, auth.uid(), p_family_id, now()
  from public.messages m
  where m.family_id = p_family_id
    and m.user_id <> auth.uid()                    -- do not mark my own messages
    and m.created_at >= coalesce(v_joined, '-infinity'::timestamptz)
  on conflict (message_id, user_id) do nothing;    -- skip ones I already read
end;
$function$;
