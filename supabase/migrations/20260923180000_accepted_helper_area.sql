-- ===========================================================================
-- Famora Social: let the sender (and their family) see roughly where an
-- accepted helper is, once one has accepted.
--
-- Fuzzy on purpose, and fuzzed around the HELPER's real position (not the
-- senders, which is what the pre-accept notification fuzz already uses) —
-- otherwise this would just mark a random point near the sender and tell
-- nobody anything. Approximate rather than exact: a helper who accepted a
-- stranger's request has not consented to their home location being shown to
-- that stranger, and if the sender is ever the actual threat (a domestic
-- situation, say), exposing the helper precisely would be a real risk to
-- them. Same ~400m fuzz radius used everywhere else in this feature.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_accepted_helper_area(p_escalation_id uuid)
 RETURNS table(lat double precision, lng double precision, fuzzy_radius_m integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_esc record;
  v_helper_lat double precision;
  v_helper_lng double precision;
begin
  select e.* into v_esc
  from public.nearby_help_escalations e
  where e.id = p_escalation_id and e.status = 'helper_found';

  if not found then
    return;
  end if;

  -- Visible to the requester or any family member of the SOS, same audience
  -- as the escalation row itself (nearby_help_escalations RLS).
  if v_esc.requester_id <> auth.uid() and not exists (
    select 1 from public.sos_alerts sa
    where sa.id = v_esc.sos_alert_id and public.is_family_member(sa.family_id)
  ) then
    return;
  end if;

  select l.lat, l.lng into v_helper_lat, v_helper_lng
  from public.locations l
  where l.user_id = v_esc.accepted_by and l.is_sharing = true
  order by l.updated_at desc
  limit 1;

  if v_helper_lat is null then
    return;
  end if;

  return query select
    v_helper_lat + (random() - 0.5) * 2 * (400 / 111320.0),
    v_helper_lng + (random() - 0.5) * 2 * (400 / 111320.0 / cos(radians(v_helper_lat))),
    400;
end;
$function$;

revoke execute on function public.get_accepted_helper_area(uuid) from public, anon;
grant  execute on function public.get_accepted_helper_area(uuid) to authenticated, service_role;
