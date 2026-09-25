-- ===========================================================================
-- Network change reported straight away, not with the next position
--
-- The signal icon on the family card only changed with a location push, and a
-- phone that is not moving pushes every 90 seconds or so. Moving from mobile
-- data to Wi-Fi therefore took up to two minutes to show.
--
-- The location service now reports a change of network (Wi-Fi to mobile or
-- back) the moment it happens, through this function. It touches ONLY the
-- signal columns: re-sending the last position instead would have refreshed
-- updated_at and made an old pin look freshly live.
--
-- Rows are updated, never created: a member with no position yet has no card
-- line to put the icon on. Families the member hides their location from are
-- skipped, the same rule as the position writer.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

begin;

create or replace function public.set_network_status(
  p_network_type text,
  p_signal_level smallint default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid  uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_network_type is null or p_network_type not in ('wifi', 'cellular') then
    raise exception 'Unknown network type' using errcode = '22023';
  end if;

  update locations l
  set signal_level = p_signal_level,
      network_type = p_network_type,
      signal_at    = now()
  from family_members fm
  where l.user_id    = v_uid
    and fm.user_id   = v_uid
    and fm.family_id = l.family_id
    and fm.show_location is distinct from false;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke execute on function public.set_network_status(text, smallint) from public, anon;
grant  execute on function public.set_network_status(text, smallint) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
