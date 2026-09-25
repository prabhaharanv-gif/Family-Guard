-- Let a person remove entries from their own Nearby Help history.
--
-- Hidden, not deleted: the rows are shared machinery (a helper row is what
-- stops the same person being asked twice about one SOS, an escalation row
-- drives the family's overlay), and neither table has a client DELETE policy
-- by design. So each side gets a "hidden" flag, flipped only through these
-- SECURITY DEFINER functions, and only for entries that are already over.

alter table public.nearby_help_notifications
  add column if not exists hidden_by_helper boolean not null default false;

alter table public.nearby_help_escalations
  add column if not exists hidden_by_requester boolean not null default false;

-- A helper hides one of their own answered requests.
create or replace function public.hide_nearby_help_notification(p_notification_id uuid)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  update public.nearby_help_notifications
     set hidden_by_helper = true
   where id = p_notification_id
     and helper_id = auth.uid()
     and response is not null;
end;
$function$;

-- A requester hides one of their own finished searches.
create or replace function public.hide_nearby_help_escalation(p_escalation_id uuid)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  update public.nearby_help_escalations
     set hidden_by_requester = true
   where id = p_escalation_id
     and requester_id = auth.uid()
     and status <> 'searching';
end;
$function$;

revoke execute on function public.hide_nearby_help_notification(uuid) from public, anon;
revoke execute on function public.hide_nearby_help_escalation(uuid)   from public, anon;
grant  execute on function public.hide_nearby_help_notification(uuid) to authenticated, service_role;
grant  execute on function public.hide_nearby_help_escalation(uuid)   to authenticated, service_role;
