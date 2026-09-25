-- Drops the temporary debug helper added in 20260923160000_debug_nearby_help_temp.sql.
-- It was only ever meant to be used once, live, to diagnose why nearby-help
-- notifications appeared empty when queried as the SOS requester (turned out
-- to be correct RLS behavior, not a bug — the requester can't see individual
-- helper notification rows, only the escalation's status).

drop function if exists public._debug_nearby_help(uuid, double precision);
