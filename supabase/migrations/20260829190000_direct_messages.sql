-- ═══════════════════════════════════════════════════════════════════════════
-- Personal (one-to-one) chat between family members
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The existing `messages` table is a single family-wide room: every member
-- sees every message. This adds private one-to-one threads alongside it, for
-- things people do not want to say in front of the whole family.
--
-- Deliberately a separate table rather than a nullable recipient_id on
-- `messages`. That column would make every existing family-chat policy,
-- trigger and query responsible for getting the privacy check right, and a
-- single missed `recipient_id is null` anywhere would leak a private message
-- into the family room. A separate table cannot fail that way.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.direct_messages (
  id uuid default gen_random_uuid() not null,
  family_id    uuid not null,
  sender_id    uuid not null,
  recipient_id uuid not null,
  content      text not null,
  created_at   timestamp with time zone default now(),
  constraint direct_messages_pkey PRIMARY KEY (id),
  constraint direct_messages_family_id_fkey    FOREIGN KEY (family_id)    REFERENCES public.families(id) ON DELETE CASCADE,
  constraint direct_messages_sender_id_fkey    FOREIGN KEY (sender_id)    REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint direct_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  -- A thread with yourself is not a feature; block it at the schema level so
  -- no client bug can create one.
  constraint direct_messages_no_self CHECK (sender_id <> recipient_id)
);

-- Thread lookup is always "messages between these two people in this family,
-- newest last", so index exactly that.
create index if not exists direct_messages_thread_idx
  on public.direct_messages (family_id, sender_id, recipient_id, created_at desc);
create index if not exists direct_messages_recipient_idx
  on public.direct_messages (recipient_id, created_at desc);

alter table public.direct_messages enable row level security;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Only the two participants can read a private message. Family membership is
-- NOT sufficient — that is the whole point of the feature.
drop policy if exists "participants read own direct messages" on public.direct_messages;
create policy "participants read own direct messages" on public.direct_messages
  as PERMISSIVE for SELECT to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Inserts go through send_direct_message() only, which is SECURITY DEFINER and
-- forces sender_id = auth.uid(). Blocking direct client inserts means a client
-- can never write a message as somebody else.
drop policy if exists "no direct client insert on direct_messages" on public.direct_messages;
create policy "no direct client insert on direct_messages" on public.direct_messages
  as PERMISSIVE for INSERT to authenticated
  with check (false);

-- You may delete your own message; the recipient may not delete what you sent.
drop policy if exists "sender deletes own direct messages" on public.direct_messages;
create policy "sender deletes own direct messages" on public.direct_messages
  as PERMISSIVE for DELETE to authenticated
  using (auth.uid() = sender_id);

-- ── Send ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_direct_message(p_family_id uuid, p_recipient_id uuid, p_content text)
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
    -- 28000 invalid_authorization_specification. NOT 'PGRST301' — errcode
    -- takes a 5-character SQLSTATE, and an 8-character value makes Postgres
    -- raise "unrecognized exception condition" instead of this message.
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

  insert into direct_messages (family_id, sender_id, recipient_id, content)
  values (p_family_id, v_uid, p_recipient_id, v_txt);
end;
$function$;

grant execute on function public.send_direct_message(uuid, uuid, text) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- postgres_changes honours RLS, so subscribers receive only the private
-- messages they are a participant in.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;

-- ── Push notification ───────────────────────────────────────────────────────
drop trigger if exists direct_message_notification on public.direct_messages;
create trigger direct_message_notification
  AFTER INSERT on public.direct_messages
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-dm-notification');

-- ── Clear a thread ──────────────────────────────────────────────────────────
-- Mirrors the family chat's Clear Chat, which deletes for everyone. Done as an
-- RPC rather than by loosening the DELETE policy: the policy lets you remove
-- only your own messages, and widening it to "any message in a thread I am in"
-- would be a broader grant than this one operation needs.
CREATE OR REPLACE FUNCTION public.clear_direct_thread(p_family_id uuid, p_other_user_id uuid)
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

  -- Only the two participants' own thread — the pair is matched in both
  -- directions so it cannot be used to delete anybody else's conversation.
  delete from direct_messages
  where family_id = p_family_id
    and (
      (sender_id = v_uid            and recipient_id = p_other_user_id) or
      (sender_id = p_other_user_id  and recipient_id = v_uid)
    );
end;
$function$;

grant execute on function public.clear_direct_thread(uuid, uuid) to authenticated;
