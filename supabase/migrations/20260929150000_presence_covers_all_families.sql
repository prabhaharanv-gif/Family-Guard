-- ===========================================================================
-- Presence follows the person, not the family that happens to be open
-- ===========================================================================
--
-- Bug: a member who belongs to two families showed the signed-out door icon in
-- one of them while they were live in the other.
--
-- mark_member_signed_out stamps signed_out_at on EVERY family row of the
-- account (signing out is an account-level act). update_member_heartbeat, the
-- only thing that moves last_active past that stamp, refreshed ONLY the family
-- currently open in the app. So after any sign-out and sign-in the open
-- family row recovered, while every other family row kept
-- signed_out_at greater than last_active for good, and its card read signed out
-- although the person was online.
--
-- Fix: the heartbeat and the offline signal now touch every row of the caller,
-- matching mark_member_signed_out. Presence is about a person on one phone, so
-- it is true in all their families at once. The caller must still be a member
-- of the family id passed in, exactly as before, and is still resolved from
-- auth.uid(), so nobody can mark anyone else.
--
-- Rows that are stale right now repair themselves: the next heartbeat from the
-- person (every 30 s while the app is open) moves last_active on all of them.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.update_member_heartbeat(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not is_family_member(p_family_id) then return; end if;

  update family_members
  set last_active = now(),
      is_online   = true
  where user_id = v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_member_offline(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not is_family_member(p_family_id) then return; end if;

  update family_members
  set is_online = false
  where user_id = v_uid;
end;
$function$;

notify pgrst, 'reload schema';
