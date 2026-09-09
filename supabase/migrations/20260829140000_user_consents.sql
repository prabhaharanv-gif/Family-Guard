-- ══════════════════════════════════════════════════════════════
-- user_consents — remembers that a user accepted the terms
-- ══════════════════════════════════════════════════════════════
--
-- ConsentGate has always read and written this table, but it was never
-- created. Every lookup failed, so the consent screen reappeared on each
-- login, and every save silently did nothing — leaving localStorage as the
-- only record, which is lost on reinstall, logout or cleared app data.
--
-- The unique (user_id, consent_type) pair is required by the client's
-- upsert(..., { onConflict: 'user_id,consent_type' }).

create table if not exists public.user_consents (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  consent_type text not null,
  agreed_at timestamp with time zone default now() not null,
  constraint user_consents_pkey PRIMARY KEY (id)
);

alter table public.user_consents
  add constraint user_consents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.user_consents
  add constraint user_consents_user_type_key UNIQUE (user_id, consent_type);

create index if not exists user_consents_user_id_idx on public.user_consents (user_id);

alter table public.user_consents enable row level security;

-- A consent record is personal: readable and writable only by its owner.
create policy "users read own consents" on public.user_consents
  as PERMISSIVE for SELECT to public
  using (auth.uid() = user_id);
create policy "users insert own consents" on public.user_consents
  as PERMISSIVE for INSERT to public
  with check (auth.uid() = user_id);
create policy "users update own consents" on public.user_consents
  as PERMISSIVE for UPDATE to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "service_role_all_user_consents" on public.user_consents
  as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);
