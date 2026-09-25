-- ===========================================================================
-- Fix: every SOS send was silently rolling back
-- ===========================================================================
--
-- _nearby_help_notify_tier(uuid, smallint, double precision) was called with
-- bare integer literals for the tier argument: _nearby_help_notify_tier(v_id,
-- 1, 2000). Postgres resolves integer-to-smallint only as an assignment
-- cast, not an implicit one, so function-argument matching failed outright:
--
--   42883: function public._nearby_help_notify_tier(uuid, integer, integer)
--   does not exist
--
-- _start_nearby_help_escalation runs AFTER INSERT on sos_alerts, in the same
-- transaction as the insert. An unhandled exception in it rolled back the
-- whole transaction, so send_sos appeared to fail (and did, at the RPC
-- level) for every caller since the migration that added this trigger was
-- applied. No sos_alerts row, no nearby_help_escalations row, nothing to
-- clean up — the rollback means none of it was ever committed.
--
-- Fix: cast the tier literals explicitly.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._start_nearby_help_escalation()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id       uuid;
  v_group_id uuid;
begin
  if new.lat = 0 and new.lng = 0 then return new; end if;

  v_group_id := coalesce(new.sos_group_id, gen_random_uuid());

  insert into public.nearby_help_escalations (sos_group_id, sos_alert_id, requester_id, lat, lng)
  values (v_group_id, new.id, new.user_id, new.lat, new.lng)
  on conflict (sos_group_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public._nearby_help_notify_tier(v_id, 1::smallint, 2000);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.advance_nearby_help_tier(p_escalation_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_esc record;
  v_job text := 'nearby_help_tier_' || replace(p_escalation_id::text, '-', '');
begin
  perform public._nearby_help_safe_unschedule(v_job);

  select * into v_esc from public.nearby_help_escalations where id = p_escalation_id for update;
  if not found or v_esc.status <> 'searching' then return; end if;

  if v_esc.current_tier = 1 then
    perform public._nearby_help_notify_tier(p_escalation_id, 2::smallint, 5000);
  elsif v_esc.current_tier = 2 then
    perform public._nearby_help_notify_tier(p_escalation_id, 3::smallint, 10000);
  else
    update public.nearby_help_escalations set status = 'exhausted' where id = p_escalation_id;
  end if;
end;
$function$;
