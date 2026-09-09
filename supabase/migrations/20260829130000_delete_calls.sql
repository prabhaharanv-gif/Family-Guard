-- ══════════════════════════════════════════════════════════════
-- Delete selected call-history rows
-- ══════════════════════════════════════════════════════════════
--
-- Companion to clear_call_history for the Calls tab's multi-select. Same
-- permission model: any member of the family the call belongs to may delete,
-- and only finished calls are removable so an in-progress call can never be
-- deleted out from under its participants.

CREATE OR REPLACE FUNCTION public.delete_calls(p_call_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_call_ids is null or array_length(p_call_ids, 1) is null then
    return 0;
  end if;

  with removed as (
    delete from calls c
    where c.id = any(p_call_ids)
      and is_family_member(c.family_id)
      and c.status in ('ended', 'declined', 'missed')
    returning 1
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$function$;
