-- ===========================================================================
-- Close three functions left world-executable by a missing revoke
-- ===========================================================================
--
-- The 2026-09-28 follow-up audit's check A/B flagged four functions. One,
-- family_joined_at(uuid), is intentional (see docs/security-verify-followup.sql)
-- and needed no change. The other three were created without a
-- "revoke ... from public" before their grant, so Postgres' default privilege
-- (execute to PUBLIC on every new function) was never removed:
--
--   try_uuid(text)                        - 20260831180000_chat_media.sql
--     granted to authenticated for the storage policies that call it; never
--     revoked from public/anon, so anon could call it too. Harmless on its
--     own (just tries a cast, returns null on failure) but inconsistent with
--     every other helper in this repo being closed to callers that do not
--     need it.
--
--   family_members_guard_protected_columns() - trigger function backfilled in
--     20260928150000_backfill_untracked_functions.sql. Trigger invocation
--     does not check EXECUTE privilege, so this never mattered functionally,
--     but the previous migration only reproduced what was live (which had
--     not been revoked either); closing it now for consistency with the
--     other trigger functions in this repo (see _trip_track).
--
--   _haversine_m(...)                     - 20260925160000_driving_trips.sql
--     pure math helper called only from inside _trip_track; never revoked
--     when it was created, despite _trip_track itself being closed in
--     20260928120000_trips_widen_stale_gap.sql. That was a mistake in this
--     audit's earlier pass, not something already covered elsewhere.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

revoke execute on function public.try_uuid(text) from public, anon;

revoke execute on function public.family_members_guard_protected_columns()
  from public, anon, authenticated;

revoke execute on function public._haversine_m(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

notify pgrst, 'reload schema';
