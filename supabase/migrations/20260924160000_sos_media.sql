-- ═══════════════════════════════════════════════════════════════════════════
-- Voice clip and photo attached to an SOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A short voice clip (recorded by the sender's phone right after the SOS goes
-- out) and an optional photo, visible ONLY to the families the SOS went to.
-- Never to Nearby Help strangers. Removed after 7 days.
--
-- One SOS can be sent to several families, one sos_alerts row each, all
-- sharing sos_group_id. The media is uploaded once and keyed by that group, so
-- every one of those families sees it. Rows without a group id (older alerts)
-- key on the alert id itself.
--
-- Object path:  <sender_id>/<sos_group_id_or_alert_id>/<file>
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sos-media', 'sos-media', false, 8388608,
  array['audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/ogg','audio/3gpp','image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.sos_media (
  id            uuid primary key default gen_random_uuid(),
  sos_group_id  uuid not null,
  sender_id     uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('voice', 'photo')),
  path          text not null unique,
  mime          text,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists sos_media_group_idx on public.sos_media (sos_group_id);
create index if not exists sos_media_created_idx on public.sos_media (created_at);

-- Can the caller see the SOS that this group id names? True for the sender and
-- for a member of any family the SOS went to.
create or replace function public.can_view_sos_media(p_sender uuid, p_group uuid)
 returns boolean
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select p_sender = auth.uid()
      or exists (
        select 1 from public.sos_alerts a
         where a.user_id = p_sender
           and (a.sos_group_id = p_group or a.id = p_group)
           and public.is_family_member(a.family_id)
      );
$function$;

revoke execute on function public.can_view_sos_media(uuid, uuid) from public, anon;
grant  execute on function public.can_view_sos_media(uuid, uuid) to authenticated, service_role;

alter table public.sos_media enable row level security;

drop policy if exists "sos media visible to sender and family" on public.sos_media;
create policy "sos media visible to sender and family" on public.sos_media
  as PERMISSIVE for SELECT to authenticated
  using (public.can_view_sos_media(sender_id, sos_group_id));

drop policy if exists "service_role_all_sos_media" on public.sos_media;
create policy "service_role_all_sos_media" on public.sos_media
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- ── Storage policies ────────────────────────────────────────────────────────
drop policy if exists "sos media read"   on storage.objects;
drop policy if exists "sos media upload" on storage.objects;

create policy "sos media read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sos-media'
    and public.can_view_sos_media(
      public.try_uuid((storage.foldername(name))[1]),
      public.try_uuid((storage.foldername(name))[2])
    )
  );

-- You can only file media under your own id, for an SOS you sent.
create policy "sos media upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sos-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.sos_alerts a
       where a.user_id = auth.uid()
         and (a.sos_group_id = public.try_uuid((storage.foldername(name))[2])
              or a.id        = public.try_uuid((storage.foldername(name))[2]))
    )
  );

-- ── Registering an uploaded file ────────────────────────────────────────────
create or replace function public.attach_sos_media(
  p_sos_alert_id uuid, p_kind text, p_path text, p_mime text default null, p_duration_ms integer default null
) returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_group uuid;
  v_max   integer := case p_kind when 'voice' then 1 else 3 end;
  v_have  integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if p_kind not in ('voice', 'photo') then
    raise exception 'Unknown media kind' using errcode = '22023';
  end if;

  select coalesce(sos_group_id, id) into v_group
    from public.sos_alerts
   where id = p_sos_alert_id and user_id = v_uid;
  if v_group is null then
    raise exception 'Not your SOS' using errcode = '42501';
  end if;

  if p_path not like v_uid::text || '/' || v_group::text || '/%' then
    raise exception 'Path does not match this SOS' using errcode = '22023';
  end if;

  -- One voice clip and up to three photos per SOS is plenty. Counted into a
  -- variable first: PL/pgSQL ends an IF condition at the first THEN it sees,
  -- so a CASE inside the condition would cut it short.
  select count(*) into v_have from public.sos_media
   where sos_group_id = v_group and sender_id = v_uid and kind = p_kind;
  if v_have >= v_max then
    raise exception 'Too many attachments for this SOS' using errcode = '22023';
  end if;

  insert into public.sos_media (sos_group_id, sender_id, kind, path, mime, duration_ms)
  values (v_group, v_uid, p_kind, p_path, p_mime, p_duration_ms)
  on conflict (path) do nothing;
end;
$function$;

revoke execute on function public.attach_sos_media(uuid, text, text, text, integer) from public, anon;
grant  execute on function public.attach_sos_media(uuid, text, text, text, integer) to authenticated, service_role;

-- Realtime, so the family's alert screen picks the clip up the moment it lands.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_media'
  ) then
    alter publication supabase_realtime add table public.sos_media;
  end if;
end $$;

-- ── 7-day retention ─────────────────────────────────────────────────────────
-- Deleting a storage.objects row in SQL does not remove the file itself, so
-- the file is removed through the Storage API (pg_net, service key from the
-- Vault, same as the notification triggers) and the row afterwards.
create or replace function public.purge_expired_sos_media()
 returns integer
 language plpgsql security definer set search_path to 'public', 'vault', 'net', 'pg_temp'
as $function$
declare
  v_key text;
  r     record;
  n     integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault — sos media not purged';
    return 0;
  end if;

  for r in select id, path from public.sos_media where created_at < now() - interval '7 days' limit 500 loop
    perform net.http_delete(
      url     := 'https://xiwfmunwodovzpzicyvu.supabase.co/storage/v1/object/sos-media/' || r.path,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    );
    delete from public.sos_media where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.purge_expired_sos_media() from public, anon, authenticated;

select cron.schedule('purge_expired_sos_media', '15 3 * * *', 'select public.purge_expired_sos_media()');
