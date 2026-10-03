-- ===========================================================================
-- READ-ONLY. Run this in the Supabase SQL Editor BEFORE the migration
-- 20260929140000_mark_dead_sessions_signed_out.sql. It changes nothing.
--
-- It lists every member the migration would mark as signed out, using the exact
-- same rule, so you can check the answer against what you know: Sudha should
-- appear for her session that died on 2026-09-29 04:29:59 UTC until she signed
-- back in; anyone healthy or merely offline must NOT appear.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

with newest as (
  -- each account: its most recently active session
  select distinct on (s.user_id) s.user_id, s.id as session_id, s.updated_at
  from auth.sessions s
  order by s.user_id, s.updated_at desc nulls last, s.created_at desc
),
state as (
  select n.user_id,
         n.session_id,
         n.updated_at as session_updated_at,
         coalesce(bool_or(not coalesce(rt.revoked, false)), false) as has_live_token,
         max(rt.updated_at) filter (where rt.revoked) as last_revoked_at
  from newest n
  left join auth.refresh_tokens rt on rt.session_id = n.session_id
  group by n.user_id, n.session_id, n.updated_at
)
select fm.display_name,
       fm.family_id,
       fm.last_active,
       fm.signed_out_at,
       case when st.user_id is null then 'no session at all'
            else 'newest session has no live token' end as why,
       st.session_id,
       st.last_revoked_at
from public.family_members fm
join auth.users u on u.id = fm.user_id
left join state st on st.user_id = fm.user_id
where fm.last_active is not null
  -- currently reads as signed in
  and (fm.signed_out_at is null
       or (fm.last_active is not null and fm.signed_out_at <= fm.last_active))
  -- no heartbeat in the last 65 min, so no leftover access token is still live
  and coalesce(fm.last_active, '-infinity'::timestamptz) < now() - interval '65 minutes'
  and (
        st.user_id is null
        or (not st.has_live_token
            and st.last_revoked_at < now() - interval '65 minutes')
      )
order by fm.display_name;
