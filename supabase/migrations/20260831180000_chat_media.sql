-- ═══════════════════════════════════════════════════════════════════════════
-- Photos, video, audio and documents in chat
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A message may now carry one attachment. The row stores the storage PATH, not
-- a URL: the bucket is private, so the client signs a short-lived URL when it
-- draws the bubble. A public bucket would have been less code, but a family
-- chat is exactly the material that must not be readable by anyone who happens
-- to have the link — and private threads are readable by two people, not by
-- the whole family, which no public URL could express.
--
-- content stays NOT NULL and holds '' for an attachment sent without a
-- caption. Making it nullable would mean auditing every reader for null.
-- ═══════════════════════════════════════════════════════════════════════════

-- media_name is kept only for documents, which are shown by name. A photo is
-- shown by being a photo, and IMG_20260831_141233.jpg under it is noise.
alter table public.messages
  add column if not exists media_path        text,
  add column if not exists media_type        text,
  add column if not exists media_mime        text,
  add column if not exists media_size        integer,
  add column if not exists media_duration_ms integer,
  add column if not exists media_name        text;

alter table public.direct_messages
  add column if not exists media_path        text,
  add column if not exists media_type        text,
  add column if not exists media_mime        text,
  add column if not exists media_size        integer,
  add column if not exists media_duration_ms integer,
  add column if not exists media_name        text;

-- Dropped and recreated rather than created-if-absent, so re-running this file
-- after 'document' was added to the list actually widens the constraint.
alter table public.messages        drop constraint if exists messages_media_type_check;
alter table public.direct_messages drop constraint if exists direct_messages_media_type_check;

alter table public.messages add constraint messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio', 'document'));
alter table public.direct_messages add constraint direct_messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio', 'document'));

-- ── Bucket ──────────────────────────────────────────────────────────────────
-- 50 MB matches what a phone produces for a short clip; anything longer is a
-- file transfer, not a chat message.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 52428800,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'video/mp4','video/quicktime','video/3gpp','video/webm',
    'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/webm','audio/wav','audio/3gpp',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','application/zip'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object paths encode who may see the file, and the policies below read them:
--   family room     <family_id>/<sender_id>/<uuid>.<ext>
--   private thread  dm/<family_id>/<uuid_a>__<uuid_b>/<uuid>.<ext>
-- where uuid_a/uuid_b are the two participants, sorted so both sides derive
-- the same folder.
--
-- A folder segment that is not a uuid must not raise — a bad path should fail
-- the policy, not error the request — hence this instead of a bare cast.
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = pg_temp
as $function$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$function$;

grant execute on function public.try_uuid(text) to authenticated;

drop policy if exists "chat media read"   on storage.objects;
drop policy if exists "chat media upload" on storage.objects;
drop policy if exists "chat media delete" on storage.objects;

-- Read: family members for a family-room file, the two participants for a
-- private one. `position(...)` rather than a join — the pair folder names both
-- participants, so membership of the thread is right there in the path.
create policy "chat media read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and case
      when (storage.foldername(name))[1] = 'dm'
        then public.is_family_member(public.try_uuid((storage.foldername(name))[2]))
             and position(auth.uid()::text in coalesce((storage.foldername(name))[3], '')) > 0
      else public.is_family_member(public.try_uuid((storage.foldername(name))[1]))
    end
  );

-- Upload: same test, plus the file has to be filed under your own id so one
-- member cannot post media into a thread they are not in.
create policy "chat media upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and case
      when (storage.foldername(name))[1] = 'dm'
        then public.is_family_member(public.try_uuid((storage.foldername(name))[2]))
             and position(auth.uid()::text in coalesce((storage.foldername(name))[3], '')) > 0
      else public.is_family_member(public.try_uuid((storage.foldername(name))[1]))
             and (storage.foldername(name))[2] = auth.uid()::text
    end
  );

-- Removing a file is for whoever uploaded it. Deleting the message does not
-- reach in here: the object is left behind rather than risking a delete that
-- takes something still referenced by a reply quote.
create policy "chat media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-media' and owner = auth.uid());

-- ── Sending, now with an optional attachment ────────────────────────────────
-- The old signatures are dropped rather than left beside the new ones: two
-- overloads differing only by trailing arguments make PostgREST resolution
-- depend on exactly which keys the client sent, which is a needless way to get
-- an ambiguous-function error in production. Every new argument has a default,
-- so an older installed build calling with the original three still resolves.
drop function if exists public.send_message(uuid, text, uuid);
drop function if exists public.send_message(uuid, text, uuid, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.send_message(
  p_family_id        uuid,
  p_content          text,
  p_reply_to_id      uuid    DEFAULT NULL,
  p_media_path       text    DEFAULT NULL,
  p_media_type       text    DEFAULT NULL,
  p_media_mime       text    DEFAULT NULL,
  p_media_size       integer DEFAULT NULL,
  p_media_duration_ms integer DEFAULT NULL,
  p_media_name       text    DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_txt  text := btrim(coalesce(p_content, ''));
  v_path text := nullif(btrim(coalesce(p_media_path, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  -- Empty was already refused implicitly by the client; state it here, with
  -- the one exception that an attachment is a message on its own.
  if v_txt = '' and v_path is null then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if length(v_txt) > 4000 then
    raise exception 'Message is too long' using errcode = '22023';
  end if;
  if v_path is not null and coalesce(p_media_type, '') not in ('image', 'video', 'audio', 'document') then
    raise exception 'Unknown media type' using errcode = '22023';
  end if;

  insert into messages (
    family_id, user_id, content, reply_to_id,
    media_path, media_type, media_mime, media_size, media_duration_ms, media_name
  )
  values (
    p_family_id, v_uid, v_txt, p_reply_to_id,
    v_path,
    case when v_path is null then null else p_media_type end,
    case when v_path is null then null else p_media_mime end,
    case when v_path is null then null else p_media_size end,
    case when v_path is null then null else p_media_duration_ms end,
    case when v_path is null then null else left(p_media_name, 200) end
  );
end;
$function$;

grant execute on function public.send_message(uuid, text, uuid, text, text, text, integer, integer, text) to authenticated;

drop function if exists public.send_direct_message(uuid, uuid, text, uuid);
drop function if exists public.send_direct_message(uuid, uuid, text, uuid, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.send_direct_message(
  p_family_id        uuid,
  p_recipient_id     uuid,
  p_content          text,
  p_reply_to_id      uuid    DEFAULT NULL,
  p_media_path       text    DEFAULT NULL,
  p_media_type       text    DEFAULT NULL,
  p_media_mime       text    DEFAULT NULL,
  p_media_size       integer DEFAULT NULL,
  p_media_duration_ms integer DEFAULT NULL,
  p_media_name       text    DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_txt  text := btrim(coalesce(p_content, ''));
  v_path text := nullif(btrim(coalesce(p_media_path, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_txt = '' and v_path is null then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if length(v_txt) > 4000 then
    raise exception 'Message is too long' using errcode = '22023';
  end if;
  if v_path is not null and coalesce(p_media_type, '') not in ('image', 'video', 'audio', 'document') then
    raise exception 'Unknown media type' using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = '42501';
  end if;

  if not exists (
    select 1 from family_members
    where user_id = p_recipient_id and family_id = p_family_id
  ) then
    raise exception 'That person is not in this family' using errcode = '42501';
  end if;

  if p_recipient_id = v_uid then
    raise exception 'Cannot message yourself' using errcode = '22023';
  end if;

  insert into direct_messages (
    family_id, sender_id, recipient_id, content, reply_to_id,
    media_path, media_type, media_mime, media_size, media_duration_ms, media_name
  )
  values (
    p_family_id, v_uid, p_recipient_id, v_txt, p_reply_to_id,
    v_path,
    case when v_path is null then null else p_media_type end,
    case when v_path is null then null else p_media_mime end,
    case when v_path is null then null else p_media_size end,
    case when v_path is null then null else p_media_duration_ms end,
    case when v_path is null then null else left(p_media_name, 200) end
  );
end;
$function$;

grant execute on function public.send_direct_message(uuid, uuid, text, uuid, text, text, text, integer, integer, text) to authenticated;
