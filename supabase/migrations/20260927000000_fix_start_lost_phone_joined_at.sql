-- start_lost_phone ordered family_members by a non-existent created_at column,
-- so tapping "Phone lost" failed with: column "created_at" does not exist.
-- The table's timestamp is joined_at.
create or replace function public.start_lost_phone(p_target uuid, p_message text default null)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_allowed boolean;
  v_name    text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public._can_manage_lost_phone(p_target) then
    raise exception 'only the phone owner or a family admin can do this' using errcode = '42501';
  end if;

  select allow_lost_mode into v_allowed from public.user_alert_prefs where user_id = p_target;
  if v_allowed is not true then
    raise exception 'this member has not allowed phone lost mode' using errcode = 'P0001';
  end if;

  select display_name into v_name from public.family_members
   where user_id = auth.uid() order by joined_at limit 1;

  insert into public.lost_phone (user_id, started_by, starter_name, message, started_at, expires_at)
  values (p_target, auth.uid(), v_name, left(nullif(trim(coalesce(p_message, '')), ''), 140),
          now(), now() + interval '12 hours')
  on conflict (user_id) do update
    set started_by = excluded.started_by, starter_name = excluded.starter_name,
        message = excluded.message, started_at = excluded.started_at, expires_at = excluded.expires_at;
end;
$function$;

revoke execute on function public.start_lost_phone(uuid, text) from public, anon;
grant  execute on function public.start_lost_phone(uuid, text) to authenticated, service_role;
