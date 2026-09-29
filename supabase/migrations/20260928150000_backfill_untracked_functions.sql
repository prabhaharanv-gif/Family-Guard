-- ===========================================================================
-- Backfill two functions that were live but had no migration file
-- ===========================================================================
--
-- The 2026-09-28 follow-up audit found family_members_guard_protected_columns
-- and _nearby_help_kind existing in the live database with nothing in this
-- repo creating them (presumably applied by hand from the dashboard at some
-- point and never committed). Source pulled live via pg_get_functiondef,
-- pg_get_triggerdef and information_schema.column_privileges and reproduced
-- here exactly, so a database rebuilt from these migrations alone would not
-- silently lose either.
--
-- family_members_guard_protected_columns is the more important of the two:
-- it is the trigger (with its matching column-level grants) that closes the
-- 2026-09-10 privilege-escalation bug where a member could PATCH role to
-- admin on their own row. Losing it in a rebuild would reopen that hole.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create or replace function public.family_members_guard_protected_columns()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role          is distinct from old.role
    or new.user_id       is distinct from old.user_id
    or new.family_id     is distinct from old.family_id
    or new.is_online     is distinct from old.is_online
    or new.last_active   is distinct from old.last_active
    or new.signed_out_at is distinct from old.signed_out_at then
      raise exception
        'family_members: role and presence columns are not directly writable; use the RPCs'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_family_members_guard_protected_columns on public.family_members;
create trigger trg_family_members_guard_protected_columns
  before update on public.family_members
  for each row execute function public.family_members_guard_protected_columns();

-- The six columns a member may edit on their own row. Matches what is live;
-- re-granting an already-granted column privilege is a no-op.
grant update (avatar_url, display_name, phone, show_location, show_online, show_last_seen)
  on public.family_members to authenticated;

-- ── The nearby-help message-to-kind classifier ───────────────────────────
create or replace function public._nearby_help_kind(p_message text)
 returns text
 language sql
 immutable
as $function$
  select case p_message
    when 'Need Ambulance'   then 'ambulance'
    when 'Natural Disaster' then 'disaster'
    when 'Fire Around Me'   then 'fire'
    else 'police'
  end
$function$;

-- Internal helper used only from inside _start_nearby_help_escalation
-- (a trigger, definer rights); no client needs to call it directly.
revoke execute on function public._nearby_help_kind(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
