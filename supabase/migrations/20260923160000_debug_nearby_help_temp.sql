-- TEMPORARY debug helper — to be dropped once the nearby-help notification
-- bug is diagnosed. Lets an authenticated caller see exactly what
-- _nearby_help_notify_tier would do for a given escalation, including the
-- raw candidate rows and how many were inserted.

CREATE OR REPLACE FUNCTION public._debug_nearby_help(p_escalation_id uuid, p_radius_m double precision default 2000)
 RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_esc      record;
  v_exclude  uuid[];
  v_candidates jsonb;
  v_inserted integer;
begin
  select * into v_esc from public.nearby_help_escalations where id = p_escalation_id;

  v_exclude := coalesce(
    (select array_agg(helper_id) from public.nearby_help_notifications where escalation_id = p_escalation_id),
    '{}'
  );

  select jsonb_agg(row_to_json(f)) into v_candidates
  from public.find_nearest_opted_in_users(v_esc.lat, v_esc.lng, p_radius_m, v_esc.requester_id, v_exclude, 10) f;

  return jsonb_build_object(
    'escalation', row_to_json(v_esc),
    'exclude', v_exclude,
    'candidates', coalesce(v_candidates, '[]'::jsonb)
  );
end;
$function$;

grant execute on function public._debug_nearby_help(uuid, double precision) to authenticated;
