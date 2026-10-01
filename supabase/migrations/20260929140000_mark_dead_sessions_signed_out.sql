-- ===========================================================================
-- Mark members whose session died on its own as signed out
-- ===========================================================================
--
-- The family card shows a signed-out door icon, but only when the member
-- pressed Sign out (mark_member_signed_out). A session the server revoked
-- gives the phone no chance to run anything, so the card kept its green tick.
--
-- Sudha, 2026-09-29: the WebView presented a refresh token 20 hours old, the
-- server revoked her whole session at 04:29:59 UTC, her location stopped, and
-- for about 4 hours her card said signed in.
--
-- This finds those accounts from the auth tables and stamps signed_out_at, the
-- same marker the button uses. The card comparison (signed_out_at greater than
-- last_active means signed out) needs no app change, and flips back on its own
-- at the next heartbeat after she signs in.
--
-- The rule, kept deliberately narrow so a phone that is merely off is never
-- called signed out:
--
--   1. Take the account newest session, by updated_at. Older abandoned
--      sessions are ignored: a WebView login that never refreshed keeps one
--      unspent token forever and would otherwise make a dead account look alive.
--   2. It is dead only if that session has NO unrevoked refresh token. A healthy
--      session, however long idle, always keeps one.
--   3. Its newest revoked token is over 65 minutes old, and the member last
--      heartbeat is too. An access token outlives the kill by up to an hour, and
--      a heartbeat in that window would move last_active past the stamp.
--   4. An account with no session at all (all deleted, for example by a global
--      sign-out from another device) counts as dead once last_active is stale.
--
-- Push tokens are NOT deleted here, unlike the button: the phone can still
-- receive SOS and call alerts while the login is dead.
--
-- Run docs/dead-session-dryrun.sql first to see exactly who this would mark.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create or replace function public.mark_dead_sessions_signed_out()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_rows integer;
begin
  with newest as (
    select distinct on (s.user_id) s.user_id, s.id as session_id
    from auth.sessions s
    order by s.user_id, s.updated_at desc nulls last, s.created_at desc
  ),
  state as (
    select n.user_id,
           coalesce(bool_or(not coalesce(rt.revoked, false)), false) as has_live_token,
           max(rt.updated_at) filter (where rt.revoked) as last_revoked_at
    from newest n
    left join auth.refresh_tokens rt on rt.session_id = n.session_id
    group by n.user_id
  )
  update public.family_members fm
  set signed_out_at = now(),
      is_online     = false
  from auth.users u
  left join state st on st.user_id = u.id
  where u.id = fm.user_id
    and fm.last_active is not null
    and (fm.signed_out_at is null
         or (fm.last_active is not null and fm.signed_out_at <= fm.last_active))
    and coalesce(fm.last_active, '-infinity'::timestamptz) < now() - interval '65 minutes'
    and (
          st.user_id is null
          or (not st.has_live_token
              and st.last_revoked_at < now() - interval '65 minutes')
        );

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- Cron and service role only. Never callable from the app.
revoke execute on function public.mark_dead_sessions_signed_out() from public, anon, authenticated;
grant  execute on function public.mark_dead_sessions_signed_out() to service_role;

-- Every 10 minutes: a dead session shows within about 75 minutes of the kill.
select cron.schedule('mark_dead_sessions_signed_out', '*/10 * * * *',
                     'select public.mark_dead_sessions_signed_out()');

notify pgrst, 'reload schema';
