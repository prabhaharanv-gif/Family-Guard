-- ===========================================================================
-- Driving trips: require a GPS-quality fix, not just speed >= 8
-- ===========================================================================
--
-- Found 2026-09-29: a trip was recorded (9.8 km, 68 min, avg 9 km/h, top
-- 56 km/h) while the person was stationary at home. The trigger only checked
-- new.speed >= 8, with no accuracy gate. A coarse (Wi-Fi/cell) fix can drift
-- tens of metres between updates while the phone does not move at all, and
-- the implied speed between two such drifted points can spike well past 8
-- km/h for a moment even though nothing moved (the reason COARSE_FIX_ACCURACY_M
-- exists in LocationFilter.java for the live pin - this trigger never had the
-- same protection).
--
-- Fix: also require new.accuracy <= 30 (metres), the same GPS-quality cutoff
-- LocationFilter already uses to distinguish a real GPS fix from a coarse
-- network guess. A moving car that briefly loses GPS (tunnel, parking garage)
-- just does not get that one fix counted - the open trip is untouched and
-- resumes once accuracy improves, so this only removes phantom distance, it
-- never truncates a real trip.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

drop trigger if exists trg_trip_track on public.locations;
create trigger trg_trip_track
  after update on public.locations
  for each row
  when (
    new.is_sharing is not false
    and new.speed is not null
    and new.speed >= 8
    and new.accuracy is not null
    and new.accuracy <= 30
  )
  execute function public._trip_track();
