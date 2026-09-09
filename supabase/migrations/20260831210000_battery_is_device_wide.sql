-- ═══════════════════════════════════════════════════════════════════════════
-- One phone, one battery — across every family the person belongs to
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Symptom: the same member showed a different battery level on each of their
-- families' cards — 13%, 14%, 15%, 16% at the same moment — and only the
-- currently-active family was right.
--
-- Cause: battery_level lives on `locations`, which has one row per (user,
-- family), and the device only ever writes the row for the family that is
-- active in the app right now (useLocationBroadcast and
-- LocationForegroundService are both started with a single familyId). Every
-- other family's row keeps whatever the level was the last time THAT family
-- was the active one, and it never advances again.
--
-- Battery is a property of the phone, not of a membership, so a reading is now
-- copied to the person's rows in their other families as well.
--
-- Deliberately NOT copied: lat/lng, accuracy, speed and updated_at. Those are
-- per-family by design — updated_at means "when this position was measured",
-- and refreshing it here would make a stale pin look freshly located, which is
-- the same reasoning set_location_status() was written with. This changes the
-- battery number only.
--
-- No new information is exposed: every one of these families could already see
-- this member's battery on their card, just an older value, and a family where
-- the member has switched sharing off still has the whole row hidden by RLS.
--
-- Both writers go through this one function — the web hook and the Android
-- foreground service both POST to rpc/upsert_location_with_battery — so this
-- covers the app whether it is in the foreground or not, with no client change.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_location_with_battery(
  p_family_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT 0,
  p_speed numeric DEFAULT NULL::numeric,
  p_battery integer DEFAULT NULL::integer,
  p_is_charging boolean DEFAULT false
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO locations (user_id,family_id,lat,lng,accuracy,speed,battery_level,is_charging,is_sharing,location_enabled,updated_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,p_accuracy,p_speed,p_battery,p_is_charging,true,true,v_now)
  ON CONFLICT (user_id,family_id) DO UPDATE SET
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,
    speed=EXCLUDED.speed,battery_level=EXCLUDED.battery_level,
    is_charging=EXCLUDED.is_charging,is_sharing=true,location_enabled=true,updated_at=v_now;

  INSERT INTO location_history (user_id,family_id,lat,lng,recorded_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,v_now);

  -- ── The new part ─────────────────────────────────────────────────────────
  -- Carry the reading to this person's other families. Battery only; the
  -- position columns and updated_at are left exactly as they were.
  IF p_battery IS NOT NULL THEN
    UPDATE locations
    SET battery_level = p_battery,
        is_charging   = p_is_charging
    WHERE user_id   = v_uid
      AND family_id <> p_family_id
      AND (battery_level IS DISTINCT FROM p_battery
           OR is_charging IS DISTINCT FROM p_is_charging);
  END IF;
END;
$function$;
