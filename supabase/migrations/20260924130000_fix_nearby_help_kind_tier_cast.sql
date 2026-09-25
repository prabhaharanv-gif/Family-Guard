-- Fix: SOS stopped sending after 20260924120000_nearby_help_kind.sql.
--
-- That migration re-created _start_nearby_help_escalation from the OLD
-- 20260924000000 text, which still had the bare literal
--   _nearby_help_notify_tier(v_id, 1, 2000)
-- and so brought back the 42883 "function ... (uuid, integer, integer) does
-- not exist" that 20260923150000 had fixed. The trigger runs inside the
-- sos_alerts INSERT, so the whole send_sos rolled back. This restores the
-- explicit ::smallint cast, keeping help_kind.

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

  insert into public.nearby_help_escalations (sos_group_id, sos_alert_id, requester_id, lat, lng, help_kind)
  values (v_group_id, new.id, new.user_id, new.lat, new.lng, public._nearby_help_kind(new.message))
  on conflict (sos_group_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public._nearby_help_notify_tier(v_id, 1::smallint, 2000);
  end if;

  return new;
end;
$function$;
