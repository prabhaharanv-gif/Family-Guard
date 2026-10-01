-- ===========================================================================
-- Conference calls: add a person to a call that is already connected
-- ===========================================================================
--
-- A call stays one row per pair of people (caller_id, callee_id), so the whole
-- existing flow is untouched: the ring, the push, accept and decline, the
-- realtime updates, the call history. A conference is several of those rows
-- that share ONE Agora channel. Adding a person creates a new row from the
-- person who added them, with the same channel name. Everyone in the channel
-- hears everyone, because Agora mixes audio for any number of people.
--
-- Leaving: a person leaves by ending every live row that involves them
-- (leave_call). The call carries on for anyone who still has a live row with
-- someone else. Its rule for the person who is left alone is simply that all
-- their rows have ended, so they leave too.
--
-- Old app builds keep working. They know only end_call, which ends one row, and
-- they never call the new functions.
--
-- What each piece does:
--   1. the channel name stops being unique, so rows can share it
--   2. add_call_participant  - ring one more family member into the call
--   3. leave_call            - end all of my live rows in this channel
--   4. get_call_participants - who is in the call, or being rung right now
--      (a person only sees their own rows, so this is how the screen learns who
--      joined through somebody else)
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- ── 1. Several rows may share a channel ────────────────────────────────────
alter table public.calls drop constraint if exists calls_agora_channel_name_key;
create index if not exists calls_agora_channel_idx on public.calls (agora_channel_name);

-- ── 2. Add a person to a connected call ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_call_participant(p_call_id uuid, p_callee_id uuid)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_src  calls%rowtype;
  v_new  calls%rowtype;
  v_live integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_src from calls where id = p_call_id;
  if v_src.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_uid not in (v_src.caller_id, v_src.callee_id) then
    raise exception 'Not a participant of this call' using errcode = 'PGRST301';
  end if;

  -- I must be connected myself: some row of this channel that involves me has
  -- been accepted. Nobody can pull a third person into a call still ringing.
  if not exists (
    select 1 from calls c
    where c.agora_channel_name = v_src.agora_channel_name
      and c.status = 'accepted'
      and v_uid in (c.caller_id, c.callee_id)
  ) then
    raise exception 'The call is not connected yet' using errcode = '22023';
  end if;

  if p_callee_id = v_uid then
    raise exception 'Cannot add yourself' using errcode = '22023';
  end if;

  if not exists (
    select 1 from family_members fm
    where fm.family_id = v_src.family_id and fm.user_id = p_callee_id
  ) then
    raise exception 'Not a member of this family' using errcode = '22023';
  end if;

  -- Already in the call, or already being rung.
  if exists (
    select 1 from calls c
    where c.agora_channel_name = v_src.agora_channel_name
      and c.status in ('ringing', 'accepted')
      and p_callee_id in (c.caller_id, c.callee_id)
  ) then
    raise exception 'Already in this call' using errcode = '22023';
  end if;

  -- Cap the size: people in the call plus people being rung.
  select count(*) into v_live from (
    select c.caller_id as u from calls c
      where c.agora_channel_name = v_src.agora_channel_name and c.status in ('ringing', 'accepted')
    union
    select c.callee_id from calls c
      where c.agora_channel_name = v_src.agora_channel_name and c.status in ('ringing', 'accepted')
  ) x;
  if v_live >= 6 then
    raise exception 'This call is full' using errcode = '22023';
  end if;

  insert into calls (family_id, caller_id, callee_id, agora_channel_name, call_type)
  values (v_src.family_id, v_uid, p_callee_id, v_src.agora_channel_name, v_src.call_type)
  returning * into v_new;

  return v_new;
end;
$function$;

-- ── 3. Leave the call ──────────────────────────────────────────────────────
-- Ends every live row of this channel that involves the caller. A row that was
-- still ringing ends as cancelled if I was the one ringing, or declined if I
-- was the one being rung.
CREATE OR REPLACE FUNCTION public.leave_call(p_call_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_src calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_src from calls where id = p_call_id;
  if v_src.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_uid not in (v_src.caller_id, v_src.callee_id) then
    raise exception 'Not a participant of this call' using errcode = 'PGRST301';
  end if;

  update calls c
  set status = case
        when c.status = 'accepted'    then 'ended'
        when c.caller_id = v_uid      then 'ended'
        else 'declined'
      end,
      ended_at = now(),
      duration_seconds = case
        when c.answered_at is not null then extract(epoch from (now() - c.answered_at))::int
        else null
      end
  where c.agora_channel_name = v_src.agora_channel_name
    and c.status in ('ringing', 'accepted')
    and v_uid in (c.caller_id, c.callee_id);
end;
$function$;

-- ── 4. Who is in the call ──────────────────────────────────────────────────
-- Everyone with a live row, as in the call (an accepted row) or being rung (a
-- ringing row). Names come from the family the call belongs to.
CREATE OR REPLACE FUNCTION public.get_call_participants(p_call_id uuid)
 RETURNS TABLE (participant_id uuid, participant_name text, participant_avatar text, participant_state text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_src calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_src from calls where id = p_call_id;
  if v_src.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_uid not in (v_src.caller_id, v_src.callee_id) then
    raise exception 'Not a participant of this call' using errcode = 'PGRST301';
  end if;

  return query
  with legs as (
    select c.caller_id, c.callee_id, c.status
    from calls c
    where c.agora_channel_name = v_src.agora_channel_name
      and c.status in ('ringing', 'accepted')
  ),
  people as (
    select l.caller_id as uid, 'in'::text as st from legs l where l.status = 'accepted'
    union all
    select l.callee_id, 'in'::text from legs l where l.status = 'accepted'
    union all
    select l.callee_id, 'ringing'::text from legs l where l.status = 'ringing'
  ),
  best as (
    select p.uid, case when bool_or(p.st = 'in') then 'in' else 'ringing' end as st
    from people p
    group by p.uid
  )
  select b.uid, coalesce(fm.display_name, ''), fm.avatar_url, b.st
  from best b
  left join family_members fm on fm.user_id = b.uid and fm.family_id = v_src.family_id;
end;
$function$;

-- Signed-in members only.
revoke execute on function public.add_call_participant(uuid, uuid)  from public, anon;
revoke execute on function public.leave_call(uuid)                  from public, anon;
revoke execute on function public.get_call_participants(uuid)       from public, anon;
grant  execute on function public.add_call_participant(uuid, uuid)  to authenticated;
grant  execute on function public.leave_call(uuid)                  to authenticated;
grant  execute on function public.get_call_participants(uuid)       to authenticated;

notify pgrst, 'reload schema';
