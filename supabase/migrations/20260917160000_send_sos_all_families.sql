-- ===========================================================================
-- One SOS reaches every family the sender belongs to
--
-- send_sos takes a single family, so a shake SOS raised with the app closed
-- only alerted whichever family was active in the app. Someone in two
-- families (parents and in-laws, say) left the other one uninformed.
--
-- send_sos_all_families inserts one alert per membership in a single call and
-- returns the new ids, so the Cancel on the receipt can withdraw every one of
-- them. Each insert fires the existing send-sos-notification trigger exactly
-- as send_sos does, so nothing downstream changes.
--
-- The native sender falls back to send_sos when this function does not exist
-- yet, so the app keeps working before this is applied.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.send_sos_all_families(
  p_lat     double precision,
  p_lng     double precision,
  p_message text default 'SOS! I need help!'
)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := '{}';
  v_id  uuid;
  r     record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Same validation as send_sos.
  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'Invalid latitude: %', p_lat using errcode = '22023';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid longitude: %', p_lng using errcode = '22023';
  end if;
  if p_message is null or trim(p_message) = '' then
    raise exception 'SOS message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_message) > 500 then
    raise exception 'SOS message too long (max 500 chars)' using errcode = '22023';
  end if;

  for r in
    select distinct family_id from family_members where user_id = v_uid
  loop
    insert into sos_alerts (user_id, family_id, lat, lng, message)
    values (v_uid, r.family_id, p_lat, p_lng, p_message)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'Not a member of any family' using errcode = 'PGRST116';
  end if;

  return v_ids;
end;
$function$;

-- Default privileges no longer grant EXECUTE to anon or PUBLIC (see
-- 20260915120000), so signed-in users need it granted explicitly.
revoke execute on function public.send_sos_all_families(double precision, double precision, text) from public, anon;
grant  execute on function public.send_sos_all_families(double precision, double precision, text) to authenticated, service_role;
