-- ═══════════════════════════════════════════════════════════════════════════
-- Personal chat: per-message actions (reply, edit, delete, message info)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Brings direct_messages up to parity with the family room, which already has
-- reply_to_id / is_edited / read receipts. Read state is kept as a single
-- read_at column rather than reusing the message_reads join table of the
-- family chat: a one-to-one thread has exactly one possible reader, so a row
-- per read would say nothing the timestamp does not.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.direct_messages
  add column if not exists reply_to_id uuid,
  add column if not exists is_edited   boolean not null default false,
  add column if not exists edited_at   timestamp with time zone,
  add column if not exists read_at     timestamp with time zone;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'direct_messages_reply_to_id_fkey'
  ) then
    alter table public.direct_messages
      add constraint direct_messages_reply_to_id_fkey
      foreign key (reply_to_id) references public.direct_messages(id) on delete set null;
  end if;
end $$;

-- Under the default replica identity, realtime puts only the primary key in a
-- OLD record of a DELETE, so the event matches neither the family_id filter
-- nor RLS, and the client of the other participant never learns the message
-- went away.
-- FULL puts the whole old row in the WAL, which is what makes a delete
-- actually reach both sides live.
alter table public.direct_messages replica identity full;

-- ── Send (now carries an optional reply target) ─────────────────────────────
-- The 3-argument version is dropped rather than left beside the new one: two
-- overloads differing only by a trailing argument make PostgREST resolution
-- depend on exactly which keys the client sent, which is a needless way to
-- get an ambiguous-function error in production.
drop function if exists public.send_direct_message(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.send_direct_message(p_family_id uuid, p_recipient_id uuid, p_content text, p_reply_to_id uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_txt text := btrim(coalesce(p_content, ''));
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_txt = '' then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if length(v_txt) > 4000 then
    raise exception 'Message is too long' using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  -- Both people must be in the SAME family. Without this a member could DM
  -- any user id they could guess, anywhere in the system.
  if not exists (
    select 1 from family_members
    where user_id = p_recipient_id and family_id = p_family_id
  ) then
    raise exception 'That person is not in this family' using errcode = '42501';
  end if;

  if p_recipient_id = v_uid then
    raise exception 'Cannot message yourself' using errcode = '22023';
  end if;

  -- A reply may only point at a message from this same two-person thread.
  -- Without this check, any message id the sender can read could be quoted
  -- into a thread it does not belong to.
  if p_reply_to_id is not null and not exists (
    select 1 from direct_messages
    where id = p_reply_to_id
      and family_id = p_family_id
      and (
        (sender_id = v_uid          and recipient_id = p_recipient_id) or
        (sender_id = p_recipient_id and recipient_id = v_uid)
      )
  ) then
    raise exception 'Cannot reply to that message' using errcode = '42501';
  end if;

  insert into direct_messages (family_id, sender_id, recipient_id, content, reply_to_id)
  values (p_family_id, v_uid, p_recipient_id, v_txt, p_reply_to_id);
end;
$function$;

grant execute on function public.send_direct_message(uuid, uuid, text, uuid) to authenticated;

-- ── Edit ────────────────────────────────────────────────────────────────────
-- Sender only, the same rule as edit_message() in the family room. There is no
-- UPDATE policy on direct_messages, so this SECURITY DEFINER function is the
-- only path that can change a private message at all.
CREATE OR REPLACE FUNCTION public.edit_direct_message(p_message_id uuid, p_new_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_txt text := btrim(coalesce(p_new_content, ''));
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_txt = '' then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if length(v_txt) > 4000 then
    raise exception 'Message is too long' using errcode = '22023';
  end if;

  if not exists (
    select 1 from direct_messages where id = p_message_id and sender_id = v_uid
  ) then
    raise exception 'Not your message' using errcode = '42501';
  end if;

  update direct_messages
  set content = v_txt, is_edited = true, edited_at = now()
  where id = p_message_id;
end;
$function$;

grant execute on function public.edit_direct_message(uuid, text) to authenticated;

-- ── Delete one message ──────────────────────────────────────────────────────
-- Deleting removes the row, so the message disappears for BOTH participants,
-- not just from the view of whoever sent it. The existing DELETE policy
-- (sender deletes own direct messages) already restricts this to your own
-- messages; the wrapper exists so the client has one named call for it, and so
-- a refused delete surfaces as a real error instead of a silent zero-row
-- delete.
CREATE OR REPLACE FUNCTION public.delete_direct_message(p_message_id uuid)
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

  if not exists (
    select 1 from direct_messages where id = p_message_id and sender_id = v_uid
  ) then
    raise exception 'Not your message' using errcode = '42501';
  end if;

  delete from direct_messages where id = p_message_id;
end;
$function$;

grant execute on function public.delete_direct_message(uuid) to authenticated;

-- ── Read receipts ───────────────────────────────────────────────────────────
-- Marks everything the other person sent me in this thread as read. It only
-- ever touches rows where I am the recipient, so it cannot be used to stamp a
-- read on behalf of somebody else.
CREATE OR REPLACE FUNCTION public.mark_direct_thread_read(p_family_id uuid, p_other_user_id uuid)
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
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  update direct_messages
  set read_at = now()
  where family_id    = p_family_id
    and recipient_id = v_uid
    and sender_id    = p_other_user_id
    and read_at is null;
end;
$function$;

grant execute on function public.mark_direct_thread_read(uuid, uuid) to authenticated;
