-- ===========================================================================
-- Wrong-password alert (Profile -> Anti-theft)
-- ===========================================================================
--
-- After several wrong screen-lock attempts the phone reports it: how many
-- attempts, where the phone was last seen, and (only if the owner also switched
-- that on) a front-camera photo. It goes to the ADMINS of the owner families,
-- not to every member, and the photo is readable only by the owner and those
-- admins. Everything is removed after 7 days.
--
-- One SOS-style report can cover several families: one unlock_alerts row per
-- family, all sharing group_id. The photo is uploaded once, keyed by group_id.
--
-- Object path:  <owner_id>/<group_id>/photo.jpg
--
-- Off unless chosen: unlock_alert is false until the owner turns it on.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

alter table public.user_alert_prefs
  add column if not exists unlock_alert boolean not null default false;

create table if not exists public.unlock_alerts (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  family_id   uuid not null,
  attempts    integer not null,
  lat         double precision,
  lng         double precision,
  photo_path  text,
  created_at  timestamptz not null default now()
);

create index if not exists unlock_alerts_family_idx on public.unlock_alerts (family_id, created_at desc);
create index if not exists unlock_alerts_group_idx  on public.unlock_alerts (group_id);

alter table public.unlock_alerts enable row level security;

drop policy if exists "owner and family admins read unlock alerts" on public.unlock_alerts;
create policy "owner and family admins read unlock alerts" on public.unlock_alerts
  as PERMISSIVE for SELECT to authenticated
  using (user_id = auth.uid() or public.is_family_admin(family_id));

drop policy if exists "service_role_all_unlock_alerts" on public.unlock_alerts;
create policy "service_role_all_unlock_alerts" on public.unlock_alerts
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- ── Photo bucket ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('unlock-photos', 'unlock-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Can the caller see the photo of this owner and group? The owner, or an admin
-- of any family the report went to.
create or replace function public.can_view_unlock_photo(p_owner uuid, p_group uuid)
 returns boolean
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select p_owner = auth.uid()
      or exists (
        select 1 from public.unlock_alerts a
         where a.user_id = p_owner and a.group_id = p_group
           and public.is_family_admin(a.family_id)
      );
$function$;

revoke execute on function public.can_view_unlock_photo(uuid, uuid) from public, anon;
grant  execute on function public.can_view_unlock_photo(uuid, uuid) to authenticated, service_role;

drop policy if exists "unlock photo read"   on storage.objects;
drop policy if exists "unlock photo upload" on storage.objects;

create policy "unlock photo read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'unlock-photos'
    and public.can_view_unlock_photo(
      public.try_uuid((storage.foldername(name))[1]),
      public.try_uuid((storage.foldername(name))[2])
    )
  );

-- You can only file a photo under your own id, for a report you made.
create policy "unlock photo upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'unlock-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.unlock_alerts a
       where a.user_id = auth.uid()
         and a.group_id = public.try_uuid((storage.foldername(name))[2])
    )
  );

-- ── The phone reports ───────────────────────────────────────────────────────
-- Returns the group id, or null when the owner has not switched this on or a
-- report was already made in the last 10 minutes.
create or replace function public.report_unlock_attempts(
  p_attempts integer, p_lat double precision default null, p_lng double precision default null
) returns uuid
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_group uuid := gen_random_uuid();
  v_on    boolean;
  n       integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select unlock_alert into v_on from public.user_alert_prefs where user_id = v_uid;
  if v_on is not true then return null; end if;

  if exists (select 1 from public.unlock_alerts
              where user_id = v_uid and created_at > now() - interval '10 minutes') then
    return null;
  end if;

  insert into public.unlock_alerts (group_id, user_id, family_id, attempts, lat, lng)
  select v_group, v_uid, fm.family_id, greatest(1, least(coalesce(p_attempts, 3), 99)),
         case when p_lat = 0 and p_lng = 0 then null else p_lat end,
         case when p_lat = 0 and p_lng = 0 then null else p_lng end
    from public.family_members fm where fm.user_id = v_uid;
  get diagnostics n = row_count;
  if n = 0 then return null; end if;
  return v_group;
end;
$function$;

revoke execute on function public.report_unlock_attempts(integer, double precision, double precision) from public, anon;
grant  execute on function public.report_unlock_attempts(integer, double precision, double precision) to authenticated, service_role;

create or replace function public.attach_unlock_photo(p_group uuid, p_path text)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.unlock_alerts set photo_path = p_path
   where group_id = p_group and user_id = auth.uid()
     and p_path like auth.uid()::text || '/' || p_group::text || '/%';
end;
$function$;

revoke execute on function public.attach_unlock_photo(uuid, text) from public, anon;
grant  execute on function public.attach_unlock_photo(uuid, text) to authenticated, service_role;

-- ── Push to the family admins ───────────────────────────────────────────────
drop trigger if exists unlock_alert_notification on public.unlock_alerts;
create trigger unlock_alert_notification
  after insert on public.unlock_alerts
  for each row execute function trg_notify_edge_function(
    'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-unlock-alert-notification'
  );

-- ── 7-day retention (files through the Storage API, then the rows) ──────────
create or replace function public.purge_expired_unlock_alerts()
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
    raise warning 'service_role_key not found in vault - unlock photos not purged';
    return 0;
  end if;

  for r in select id, photo_path from public.unlock_alerts where created_at < now() - interval '7 days' limit 500 loop
    if r.photo_path is not null then
      perform net.http_delete(
        url     := 'https://xiwfmunwodovzpzicyvu.supabase.co/storage/v1/object/unlock-photos/' || r.photo_path,
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
        timeout_milliseconds := 5000
      );
    end if;
    delete from public.unlock_alerts where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.purge_expired_unlock_alerts() from public, anon, authenticated;

select cron.schedule('purge_expired_unlock_alerts', '25 3 * * *', 'select public.purge_expired_unlock_alerts()');

notify pgrst, 'reload schema';
