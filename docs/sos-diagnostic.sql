-- SOS diagnostic. Run in the Supabase SQL Editor.
--
-- Calls send_sos as the person who most recently sent an SOS, for the family
-- they sent it to (so they are certain to be a member), then ALWAYS rolls back:
-- nothing is saved and nobody is alerted. The result text says what happened:
--   RESULT: P0001 | SEND_SOS_OK_ROLLBACK   -> send_sos works
--   anything else                          -> that is the real error
--
-- Note: several older functions raise "Not a member of this family" with the
-- error code PGRST116, which Postgres does not recognise, so that guard shows
-- up as 42704 unrecognized exception condition PGRST116. If you see that, the
-- account used here is not in that family. It is not an SOS outage.
--
-- No apostrophes in comments: the editor splits statements naively.

do $t$
declare
  v_user uuid;
  v_fam  uuid;
begin
  select user_id, family_id into v_user, v_fam
    from public.sos_alerts
   order by created_at desc
   limit 1;

  if v_user is null then
    raise exception 'NO_SOS_ALERTS_YET';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.send_sos(v_fam, 11.1559, 77.3100, 'diagnostic');

  raise exception 'SEND_SOS_OK_ROLLBACK';
exception when others then
  raise exception 'RESULT: % | %', sqlstate, sqlerrm;
end
$t$;
