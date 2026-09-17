-- Device health reporting
--
-- Why: a member whose location stops updating looks the same from the database
-- whether their phone was killed by the OEM, never had background location
-- granted, or is simply switched off. Diagnosing a silent member meant comparing
-- timestamps across tables and inferring. These three columns let the phone say
-- so itself, while it is still working and able to.
--
-- They live on `locations` because that is already the per-device reporting row
-- the family view reads, and because the client writes them with the same RLS
-- policy it already uses for its own rows — no new table, no new policy.
--
-- Nullable with no default: NULL means "this device has not reported yet"
-- (an older client, or a member who has not opened the app since the update),
-- which must read differently from a genuine false.

alter table public.locations
  add column if not exists bg_location_granted boolean,
  add column if not exists battery_opt_ignored boolean,
  add column if not exists app_version         text;

comment on column public.locations.bg_location_granted is
  'ACCESS_BACKGROUND_LOCATION granted on the reporting device. NULL = not yet reported.';
comment on column public.locations.battery_opt_ignored is
  'Device is exempt from battery optimisation. NULL = not yet reported. False is the most common cause of a member going silent on OEM skins.';
comment on column public.locations.app_version is
  'versionName (versionCode) of the app that last reported. NULL = not yet reported.';
