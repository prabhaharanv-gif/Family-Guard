-- ═══════════════════════════════════════════════════════════════════════════
-- Emoji reactions on a message (long press → tap an emoji)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row per person per message, so reacting again REPLACES your emoji and
-- tapping the one you already chose clears it. That is the behaviour people
-- know from every other chat app, and it keeps the bubble readable in a family
-- room: at most one chip per member however many times they change their mind.
--
-- The family room and the private threads live in different tables, so the
-- row says which with `kind` rather than carrying two nullable foreign keys.
-- There is deliberately no FK on message_id for that reason; a reaction to a
-- deleted message is cleaned up by the delete RPCs below.
--
-- family_id is stored even though it is derivable, because the SELECT policy
-- has to answer "may this person see this reaction" without joining out to a
-- table whose own policies would then have to be re-entered.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.message_reactions (
  message_id uuid        not null,
  kind       text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  family_id  uuid        not null references public.families(id) on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  constraint message_reactions_pkey primary key (message_id, kind, user_id),
  constraint message_reactions_kind_check  check (kind in ('family', 'direct')),
  constraint message_reactions_emoji_check check (char_length(emoji) between 1 and 16)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (kind, message_id);

alter table public.message_reactions enable row level security;

-- A DELETE event under the default replica identity carries only the primary
-- key, which matches neither the family_id filter nor RLS — so removing a
-- reaction would never reach the other phones live.
alter table public.message_reactions replica identity full;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- You can see a reaction exactly when you can see the message it is on: any
-- family member for the family room, the two participants for a private
-- thread. Nobody may write a reaction as somebody else.
drop policy if exists "read reactions on visible messages" on public.message_reactions;
create policy "read reactions on visible messages" on public.message_reactions
  for select
  using (
    case
      when kind = 'family' then is_family_member(family_id)
      else exists (
        select 1 from public.direct_messages dm
        where dm.id = message_reactions.message_id
          and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
      )
    end
  );

drop policy if exists "write own reactions" on public.message_reactions;
create policy "write own reactions" on public.message_reactions
  for all
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Set, change or clear my reaction ────────────────────────────────────────
-- A null or empty emoji clears it, which is how the client toggles: tapping
-- the emoji you already have sends null.
create or replace function public.set_message_reaction(
  p_message_id uuid,
  p_kind       text,
  p_emoji      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid       uuid := auth.uid();
  v_emoji     text := btrim(coalesce(p_emoji, ''));
  v_family_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_kind not in ('family', 'direct') then
    raise exception 'Invalid message kind: %', p_kind using errcode = '22023';
  end if;
  if char_length(v_emoji) > 16 then
    raise exception 'Not an emoji' using errcode = '22023';
  end if;

  -- Resolving the family here is what authorises the write: a message you
  -- cannot see yields no row, so the reaction cannot be created.
  if p_kind = 'family' then
    select m.family_id into v_family_id
    from messages m
    where m.id = p_message_id
      and is_family_member(m.family_id);
  else
    select dm.family_id into v_family_id
    from direct_messages dm
    where dm.id = p_message_id
      and (dm.sender_id = v_uid or dm.recipient_id = v_uid);
  end if;

  if v_family_id is null then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_emoji = '' then
    delete from message_reactions
    where message_id = p_message_id and kind = p_kind and user_id = v_uid;
    return;
  end if;

  insert into message_reactions (message_id, kind, user_id, family_id, emoji)
  values (p_message_id, p_kind, v_uid, v_family_id, v_emoji)
  on conflict (message_id, kind, user_id) do update
    set emoji      = excluded.emoji,
        created_at = now();
end;
$function$;

revoke all on function public.set_message_reaction(uuid, text, text) from public;
grant execute on function public.set_message_reaction(uuid, text, text) to authenticated;

-- ── Deleting a message takes its reactions with it ──────────────────────────
-- Without the FK that would otherwise do this, the delete RPCs clean up.
CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM messages
    WHERE id = p_message_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your message';
  END IF;

  DELETE FROM message_reactions WHERE message_id = p_message_id AND kind = 'family';
  DELETE FROM messages WHERE id = p_message_id;
END;
$function$;

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
    select 1 from direct_messages
    where id = p_message_id and sender_id = v_uid
  ) then
    raise exception 'Not your message' using errcode = '42501';
  end if;

  delete from message_reactions where message_id = p_message_id and kind = 'direct';
  delete from direct_messages where id = p_message_id;
end;
$function$;

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
