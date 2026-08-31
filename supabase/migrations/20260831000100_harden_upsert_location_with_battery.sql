-- Harden upsert_location_with_battery.
--
-- This is the function the app calls on its hot path (useLocationBroadcast
-- writes through it every 20 seconds), but it was missing nearly every guard
-- its sibling upsert_location already had:
--
--   1. No family membership check, so any authenticated user could write
--      location rows into a family they do not belong to.
--   2. is_sharing / location_enabled were hardcoded to true on every write,
--      so the function could not express "not sharing" at all. A user's
--      privacy toggle was enforced only in client code, and a stale client
--      (or the <=20s window before checkSharing refreshes) silently flipped
--      sharing back on.
--   3. No coordinate validation.
--   4. search_path omitted pg_temp. Postgres searches the temp schema first
--      when pg_temp is not listed explicitly, leaving the relation names in
--      this function shadowable.
--   5. It wrote a full movement trail to location_history, which the app's
--      privacy policy and consent screen both state is never kept. That
--      INSERT is removed here; the table itself is dropped in the following
--      migration.
--
-- The signature is unchanged so existing clients keep working.

CREATE OR REPLACE FUNCTION public.upsert_location_with_battery(
  p_family_id   uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric DEFAULT 0,
  p_speed       numeric DEFAULT NULL::numeric,
  p_battery     integer DEFAULT NULL::integer,
  p_is_charging boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid        := auth.uid();
  v_now     timestamptz := now();
  v_sharing boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;

  -- Authorization: never take the caller's word for which family this is.
  IF NOT is_family_member(p_family_id) THEN
    RAISE EXCEPTION 'Not a member of this family' USING errcode = '42501';
  END IF;

  IF p_lat IS NULL OR p_lat < -90 OR p_lat > 90 THEN
    RAISE EXCEPTION 'Invalid latitude: %', p_lat USING errcode = '22023';
  END IF;
  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Invalid longitude: %', p_lng USING errcode = '22023';
  END IF;

  -- Honour the member's own privacy toggle here rather than trusting the
  -- client to stop calling us. family_members.show_location is the same
  -- source of truth the app reads in useLocationBroadcast.checkSharing().
  SELECT show_location INTO v_sharing
  FROM family_members
  WHERE user_id = v_uid AND family_id = p_family_id;

  IF NOT coalesce(v_sharing, true) THEN
    -- Sharing is off: record that fact and discard the coordinates entirely.
    INSERT INTO locations (user_id, family_id, is_sharing, location_enabled, updated_at)
    VALUES (v_uid, p_family_id, false, false, v_now)
    ON CONFLICT (user_id, family_id) DO UPDATE SET
      is_sharing       = false,
      location_enabled = false,
      updated_at       = v_now;
    RETURN;
  END IF;

  INSERT INTO locations (
    user_id, family_id, lat, lng, accuracy, speed,
    battery_level, is_charging, is_sharing, location_enabled, updated_at
  )
  VALUES (
    v_uid, p_family_id, p_lat, p_lng, p_accuracy, p_speed,
    p_battery, p_is_charging, true, true, v_now
  )
  ON CONFLICT (user_id, family_id) DO UPDATE SET
    lat              = EXCLUDED.lat,
    lng              = EXCLUDED.lng,
    accuracy         = EXCLUDED.accuracy,
    speed            = EXCLUDED.speed,
    battery_level    = EXCLUDED.battery_level,
    is_charging      = EXCLUDED.is_charging,
    is_sharing       = true,
    location_enabled = true,
    updated_at       = v_now;
END;
$function$;
