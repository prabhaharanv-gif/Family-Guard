-- ===========================================================================
-- One-time cleanup: merge trips fragmented under the old 5-minute gap rule
-- ===========================================================================
--
-- Run once, after 20260928120000_trips_widen_stale_gap.sql. Existing closed
-- trips that were split by a stop under 12 minutes get folded back into one
-- row: earliest start, latest end, summed distance and hard-brake/hard-start
-- counts, the fastest top speed, and the last known position. Open trips are
-- left alone so an in-progress drive is never touched.
--
-- One statement on purpose: the dashboard SQL Editor sends each top-level
-- statement over its own connection, so temp tables created in an earlier
-- statement are gone by the next one. Everything here happens inside a
-- single WITH, so the update and the delete see the same snapshot.
--
-- Safe to run more than once: once a group is merged its rows are >12 min
-- apart (or gone), so a second pass finds nothing left to fold.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

with gaps as (
  select
    id, user_id, family_id, started_at, ended_at,
    distance_m, top_kmh, hard_brakes, hard_accels, last_lat, last_lng,
    lag(ended_at) over w as prev_ended_at
  from public.trips
  where not is_open
  window w as (partition by user_id, family_id order by started_at, id)
),
islands as (
  select
    id, user_id, family_id, started_at, ended_at,
    distance_m, top_kmh, hard_brakes, hard_accels, last_lat, last_lng,
    sum(case when prev_ended_at is null
                or started_at - prev_ended_at > interval '12 minutes'
             then 1 else 0 end)
      over (partition by user_id, family_id order by started_at, id) as grp
  from gaps
),
groups as (
  select
    user_id, family_id, grp,
    max(ended_at) as ended_at,
    sum(distance_m) as distance_m,
    max(top_kmh) as top_kmh,
    sum(hard_brakes) as hard_brakes,
    sum(hard_accels) as hard_accels,
    (array_agg(last_lat order by started_at desc))[1] as last_lat,
    (array_agg(last_lng order by started_at desc))[1] as last_lng,
    (array_agg(id order by started_at asc))[1] as keep_id,
    count(*) as n
  from islands
  group by user_id, family_id, grp
  having count(*) > 1
),
upd as (
  update public.trips t set
    ended_at    = g.ended_at,
    distance_m  = g.distance_m,
    top_kmh     = g.top_kmh,
    hard_brakes = g.hard_brakes,
    hard_accels = g.hard_accels,
    last_lat    = g.last_lat,
    last_lng    = g.last_lng
  from groups g
  where t.id = g.keep_id
  returning t.id
)
delete from public.trips t
using islands i, groups g
where t.id = i.id
  and i.user_id = g.user_id and i.family_id = g.family_id and i.grp = g.grp
  and t.id <> g.keep_id;
