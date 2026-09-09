-- ── Delete for me ───────────────────────────────────────────────────────────
-- Records which messages a person has hidden from their own view.
--
-- Deleting someone else's message outright is deliberately not allowed:
-- delete_message and delete_direct_message both check auth.uid() against the
-- sender, so "delete for everyone" stays with whoever wrote it. This gives the
-- reader a way to clear a message from their own list without touching what
-- anyone else sees — previously the only option was Clear Chat, which is
-- admin-only and wipes the entire conversation for the whole family.
--
-- message_id carries no foreign key because it may point at either
-- public.messages or public.direct_messages; `kind` says which. A row therefore
-- outlives the message it refers to if that message is later deleted. That is
-- harmless — the id is never resurrected — and cheap to leave.

create table if not exists public.hidden_messages (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  message_id uuid        not null,
  kind       text        not null,
  created_at timestamptz not null default now(),
  constraint hidden_messages_pkey primary key (user_id, message_id, kind),
  constraint hidden_messages_kind_check check (kind in ('family', 'direct'))
);

create index if not exists hidden_messages_user_idx
  on public.hidden_messages (user_id, kind);

alter table public.hidden_messages enable row level security;

-- A hidden row is private to the person who made it: they are the only one who
-- may read, create or remove it.
drop policy if exists "own hidden messages" on public.hidden_messages;
create policy "own hidden messages" on public.hidden_messages
  for all
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Hide one message for the caller ─────────────────────────────────────────
-- user_id comes from auth.uid() server-side, so a client cannot hide messages
-- on someone else's behalf.
create or replace function public.hide_message(p_message_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind not in ('family', 'direct') then
    raise exception 'Invalid message kind: %', p_kind;
  end if;

  insert into public.hidden_messages (user_id, message_id, kind)
  values (auth.uid(), p_message_id, p_kind)
  on conflict (user_id, message_id, kind) do nothing;
end;
$$;

revoke all on function public.hide_message(uuid, text) from public;
grant execute on function public.hide_message(uuid, text) to authenticated;
