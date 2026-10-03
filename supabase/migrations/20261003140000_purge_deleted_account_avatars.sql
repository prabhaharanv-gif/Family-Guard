-- ===========================================================================
-- Delete the profile photo of an account that no longer exists
-- ===========================================================================
--
-- A profile photo is stored at avatars/<user id>/avatar.<ext>. The bucket is
-- public, so anyone holding the link can open it without signing in.
-- delete_my_account() removes the database rows and the auth user but never
-- touches storage, so the photo outlived the account it belonged to.
--
-- One nightly job removes any avatars file whose first folder is the id of a
-- user that no longer exists. Folders that are not a uuid are left alone.
--
-- Deleting a storage.objects row in SQL does not remove the file itself, so
-- the file goes through the Storage API (pg_net, service key from the Vault),
-- the same way purge_orphaned_chat_media does. The Storage API removes the row.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create or replace function public.purge_deleted_account_avatars()
 returns integer
 language plpgsql security definer set search_path to 'public', 'storage', 'auth', 'vault', 'net', 'pg_temp'
as $function$
declare
  v_key text;
  r     record;
  n     integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault - avatars not purged';
    return 0;
  end if;

  for r in
    select o.name
      from storage.objects o
     where o.bucket_id = 'avatars'
       and public.try_uuid((storage.foldername(o.name))[1]) is not null
       and not exists (
         select 1 from auth.users u
          where u.id = public.try_uuid((storage.foldername(o.name))[1])
       )
     order by o.created_at
     limit 500
  loop
    perform net.http_delete(
      url     := 'https://xiwfmunwodovzpzicyvu.supabase.co/storage/v1/object/avatars/' || r.name,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    );
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.purge_deleted_account_avatars() from public, anon, authenticated;

select cron.schedule('purge_deleted_account_avatars', '45 3 * * *', 'select public.purge_deleted_account_avatars()');
