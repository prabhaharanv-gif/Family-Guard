-- ══════════════════════════════════════════════════════════════
-- Call history — clear action for the Calls tab
-- ══════════════════════════════════════════════════════════════
--
-- Mirrors the "Clear Chat" behaviour on Messages: any family member may clear,
-- and it clears for the whole family rather than just the caller. Kept
-- SECURITY DEFINER because the calls table blocks all direct client writes.

CREATE OR REPLACE FUNCTION public.clear_call_history(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  -- Only finished calls: deleting a live one would strip the row out from
  -- under both participants mid-call.
  delete from calls
  where family_id = p_family_id
    and status in ('ended', 'declined', 'missed');
end;
$function$;
