-- ===========================================================================
-- Delete chat attachments once no message points at them
-- ===========================================================================
--
-- Until now an attachment outlived its message. Deleting a message, clearing a
-- chat, the 90-day message retention job and account deletion all removed the
-- row and left the file in the chat-media bucket (see the note above the
-- chat media delete policy in 20260831180000_chat_media.sql). The privacy
-- policy promised 90 days, so the files were kept longer than we said.
--
-- Rather than touch each of those delete paths, one nightly job removes any
-- chat-media file that no message or direct message references. That covers
-- every path above, plus uploads that were never sent.
--
-- A file is only a candidate once it is a day old, so an upload that is still
-- waiting for its send_message call is never taken.
--
-- Deleting a storage.objects row in SQL does not remove the file itself, so
-- the file goes through the Storage API (pg_net, service key from the Vault),
-- the same way purge_expired_sos_media does. The Storage API removes the row.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- The job asks, for each old file, whether any message names it.
create index if not exists messages_media_path_idx
  on public.messages (media_path) where media_path is not null;
create index if not exists direct_messages_media_path_idx
  on public.direct_messages (media_path) where media_path is not null;

create or replace function public.purge_orphaned_chat_media()
 returns integer
 language plpgsql security definer set search_path to 'public', 'storage', 'vault', 'net', 'pg_temp'
as $function$
declare
  v_key text;
  r     record;
  n     integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault - chat media not purged';
    return 0;
  end if;

  for r in
    select o.name
      from storage.objects o
     where o.bucket_id = 'chat-media'
       and o.created_at < now() - interval '1 day'
       and not exists (select 1 from public.messages m        where m.media_path = o.name)
       and not exists (select 1 from public.direct_messages d where d.media_path = o.name)
     order by o.created_at
     limit 500
  loop
    perform net.http_delete(
      url     := 'https://xiwfmunwodovzpzicyvu.supabase.co/storage/v1/object/chat-media/' || r.name,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    );
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.purge_orphaned_chat_media() from public, anon, authenticated;

select cron.schedule('purge_orphaned_chat_media', '30 3 * * *', 'select public.purge_orphaned_chat_media()');
