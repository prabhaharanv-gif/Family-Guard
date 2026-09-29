-- Diagnostic: why Sudha's trips are not showing in the Family trips sheet.
-- Read-only, changes nothing. Run in the Supabase SQL Editor.

-- For every member of every family: is Driving trips currently on for them,
-- and how many trips do they have in the last 7 days under THAT family_id.
-- If a name shows driving_trips_on = false, they turned it off (which also
-- deletes their own trip history, by design). If driving_trips_on = true but
-- trips_last_7d = 0, the trips exist somewhere but not scoped to this family.
select fm.family_id, f.name as family_name, fm.display_name, fm.user_id,
       coalesce(uap.driving_trips, false) as driving_trips_on,
       count(t.id) as trips_last_7d
from public.family_members fm
join public.families f on f.id = fm.family_id
left join public.user_alert_prefs uap on uap.user_id = fm.user_id
left join public.trips t on t.user_id = fm.user_id and t.family_id = fm.family_id
  and t.started_at >= now() - interval '7 days'
group by fm.family_id, f.name, fm.display_name, fm.user_id, uap.driving_trips
order by f.name, fm.display_name;

-- If the query above shows 0 trips for Sudha despite driving_trips_on being
-- true, this second query finds ALL her trips regardless of family_id, to
-- see if they exist but are tagged with a different family than expected.
select id, family_id, user_id, started_at, ended_at, distance_m, is_open
from public.trips
where user_id = (
  select user_id from public.family_members where display_name = 'Sudha' limit 1
)
order by started_at desc
limit 30;
