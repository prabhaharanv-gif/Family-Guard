-- ============================================================================
-- The callee app tells the caller that it is showing the ring
-- ============================================================================
--
-- 20261005120000_call_ring_sent let the server stamp calls.ring_sent_at once FCM
-- accepted the push. A callee with no push token (signed in on the web, for one)
-- never got that stamp, so the caller kept seeing Calling although the incoming call
-- screen was up on the other side.
--
-- Now the callee app stamps it itself as soon as it shows the ring, through this
-- function: the only thing it may change, only on its own call, only while the call is
-- still ringing, and only once.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.

create or replace function public.ack_call_ringing(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  update calls
     set ring_sent_at = now()
   where id = p_call_id
     and callee_id = v_uid
     and status = 'ringing'
     and ring_sent_at is null;
end;
$function$;

revoke all on function public.ack_call_ringing(uuid) from public, anon;
grant execute on function public.ack_call_ringing(uuid) to authenticated;
