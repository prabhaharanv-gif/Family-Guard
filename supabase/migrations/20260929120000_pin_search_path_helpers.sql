-- ===========================================================================
-- Pin search_path on two helpers the 2026-09-28 batch missed
-- ===========================================================================
--
-- Security Advisor (2026-09-29) flagged public._nearby_help_kind and
-- public._haversine_m as Function Search Path Mutable. Both are already
-- closed to anon/authenticated (revoke in 20260928150000 and 20260928160000
-- respectively), called only from inside trigger/definer functions, so this
-- is hardening rather than a live gap. Same fix as the 2026-08-28 batch
-- (clear_family_messages, delete_message, edit_message, send_message,
-- set_location_sharing): pin search_path so a schema earlier in a callers
-- search_path cannot shadow an unqualified reference.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create or replace function public._nearby_help_kind(p_message text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case p_message
    when 'Need Ambulance'   then 'ambulance'
    when 'Natural Disaster' then 'disaster'
    when 'Fire Around Me'   then 'fire'
    else 'police'
  end
$function$;

revoke execute on function public._nearby_help_kind(text) from public, anon, authenticated;

create or replace function public._haversine_m(lat1 double precision, lng1 double precision,
                                                lat2 double precision, lng2 double precision)
 returns double precision
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$function$;

revoke execute on function public._haversine_m(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

notify pgrst, 'reload schema';
