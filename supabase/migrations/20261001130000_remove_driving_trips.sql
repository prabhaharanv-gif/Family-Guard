-- Remove Driving trips.
--
-- The feature was taken out of the app (2026-10-01): its data was too incomplete to be
-- reliable. This stops the server recording trips and removes everything it built. The
-- earlier driving_trips / trips_* migrations stay as they are: they are history that has
-- already run, and this one undoes them.
--
-- WARNING: dropping public.trips permanently deletes every recorded trip.
--
-- Overspeed alert and Crash detection are separate and are not touched.

-- Stop the two scheduled jobs (no error if one was never scheduled).
do $$
begin
  perform cron.unschedule('close_stale_trips');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('purge_old_trips');
exception when others then null;
end $$;

-- Stop recording: the trigger on locations, then the functions it and the jobs called.
drop trigger  if exists trg_trip_track on public.locations;
drop function if exists public._trip_track();
drop function if exists public.close_stale_trips();
-- Only the trips code used this helper.
drop function if exists public._haversine_m(double precision, double precision, double precision, double precision);

-- The data, and the on/off switch each member had.
drop table if exists public.trips;
alter table public.user_alert_prefs drop column if exists driving_trips;

notify pgrst, 'reload schema';
