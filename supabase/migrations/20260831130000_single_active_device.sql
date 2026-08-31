-- One account, one device.
--
-- Supabase auth allows a user to hold valid sessions on any number of devices.
-- This adds a single-active-device rule on top: the most recent sign-in wins,
-- and every other device is signed out the next time it hears from the server.
--
-- ── Why newest-wins rather than blocking the new device ────────────────────
-- Refusing the new sign-in until the old device signs out would lock a user
-- out of their own account the moment they lose or replace a phone — and for
-- an app whose purpose is reaching family in an emergency, being locked out is
-- itself a safety failure. Newest-wins keeps the account always reachable from
-- whatever device the person is actually holding.
--
-- ── Shape ─────────────────────────────────────────────────────────────────
-- One row per user naming the device that currently owns the session. The
-- client claims it on sign-in and on resume; other devices watch the row over
-- realtime and sign themselves out when it stops naming them.
--
-- device_id is a client-generated opaque string, not a hardware identifier.
-- Play restricts access to hardware IDs, and a random per-install value is
-- enough here: it only has to distinguish one install from another.

create table if not exists public.user_active_device (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  device_id    text        not null,
  device_label text,
  claimed_at   timestamptz not null default now()
);

alter table public.user_active_device enable row level security;

-- A user may only ever see their own row. Nobody can see anyone else's, so
-- this table cannot be used to learn when another person is online.
create policy "read own active device"
  on public.user_active_device
  as permissive for select
  to public
  using (user_id = auth.uid());

-- Writes go exclusively through claim_active_device() below, so a client
-- cannot park a row that names a device it does not control.
create policy "no direct client insert on active device"
  on public.user_active_device
  as permissive for insert to authenticated with check (false);

create policy "no direct client update on active device"
  on public.user_active_device
  as permissive for update to public using (false);

create policy "no direct client delete on active device"
  on public.user_active_device
  as permissive for delete to public using (false);

create policy "service_role_all_active_device"
  on public.user_active_device
  as permissive for all to service_role using (true) with check (true);

-- Claim the session for this device.
--
-- SECURITY DEFINER so it can write through the deny-all client policies above,
-- but it derives the user from auth.uid() and never from an argument, so a
-- caller can only ever claim their own session.
create or replace function public.claim_active_device(
  p_device_id    text,
  p_device_label text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_device_id is null or length(trim(p_device_id)) = 0 then
    raise exception 'device_id required';
  end if;

  insert into public.user_active_device (user_id, device_id, device_label, claimed_at)
  values (v_uid, p_device_id, left(coalesce(p_device_label, ''), 120), now())
  on conflict (user_id) do update
    set device_id    = excluded.device_id,
        device_label = excluded.device_label,
        claimed_at   = now();
end;
$$;

revoke all on function public.claim_active_device(text, text) from public;
grant execute on function public.claim_active_device(text, text) to authenticated;

-- Cheap check for a client that has been offline and may have missed the
-- realtime event. Returns true when this device still owns the session.
create or replace function public.is_active_device(p_device_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_active_device
    where user_id = auth.uid()
      and device_id = p_device_id
  );
$$;

revoke all on function public.is_active_device(text) from public;
grant execute on function public.is_active_device(text) to authenticated;

-- Realtime must carry this table for other devices to be notified promptly.
-- Without it they would only find out on their next resume check.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_active_device'
  ) then
    alter publication supabase_realtime add table public.user_active_device;
  end if;
end $$;
