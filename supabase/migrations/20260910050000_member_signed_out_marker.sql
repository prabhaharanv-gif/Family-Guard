-- Record when a member deliberately signs out.
--
-- The family list could say whether someone had ever set the app up
-- (last_active is written only by update_member_heartbeat, from a signed-in
-- foreground client) but not whether they were still signed in: last_active is
-- a timestamp of the last heartbeat, and signing out does not erase it. A
-- member who signed out looked identical to one whose phone was simply off.
--
-- signed_out_at is stamped on an explicit sign-out and is never cleared. It
-- does not need to be: the next heartbeat moves last_active past it, so
--
--     signed_out_at > last_active  →  signed out
--
-- reads correctly again the moment they sign back in, with no second RPC to
-- forget to call and no window where the two disagree.
--
-- What this does NOT catch, deliberately and unavoidably: an uninstall, a
-- force-stop, a wiped phone, or a session that expired on its own. None of
-- those give the app a chance to run anything, so such a member keeps showing
-- as signed in. This marks a deliberate sign-out, which is the case a family
-- can actually act on.

alter table public.family_members
  add column if not exists signed_out_at timestamp with time zone;

comment on column public.family_members.signed_out_at is
  'Set when the member explicitly signs out. Never cleared — compare against '
  'last_active, which a later heartbeat moves past it. Null means they have '
  'never signed out on this row.';

-- Stamps every row belonging to the caller, across all their families: signing
-- out is an account-level act, not a per-family one, and the client no longer
-- knows which families it belonged to once auth.signOut() has run.
--
-- SECURITY DEFINER and resolved from auth.uid(), mirroring
-- update_member_heartbeat and set_member_offline: a client can only ever mark
-- itself, never another member.
CREATE OR REPLACE FUNCTION public.mark_member_signed_out()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;

  update family_members
  set signed_out_at = now(),
      is_online     = false
  where user_id = v_uid;
end;
$function$;

grant execute on function public.mark_member_signed_out() to authenticated;
