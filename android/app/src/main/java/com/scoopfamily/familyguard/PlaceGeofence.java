package com.scoopfamily.familyguard;

import android.location.Location;

import java.util.ArrayList;
import java.util.List;

/**
 * Tracks each member's saved Places (Home, Office, ...) and decides when a
 * fresh location fix confirms they have arrived at or left one.
 *
 * Two fixes to confirm, not the raw radius test alone
 * -----------------------------------------------------
 * A fix exactly at a place's edge flips in and out of the radius from GPS
 * noise alone. Requiring the SAME crossing to repeat on the very next fix —
 * the same reasoning as LocationFilter's held-jump pattern, see that class —
 * means one noisy fix cannot fire a false "left Home" moments after a real
 * "reached Home". decide() below is the state machine that does this: no
 * Android types, no clock, no I/O, so it runs and is tested on a plain JVM,
 * same split as LocationFilter between the pure decision and the impure
 * caller that measures distance with Location#distanceTo.
 *
 * Deliberately NOT plumbed through LocationForegroundService's push gate
 * (LocationFilter/lastPushedLocation): that gate exists to decide what is
 * worth writing to the map trail, and can hold a fix back for up to 90s or
 * drop it outright below 100m accuracy — exactly the kind of fix you get
 * walking into a building. Geofence detection runs on every raw fix instead.
 *
 * The accuracy gate scales with each place's own radius (device-verified
 * 2026-09-23: a flat 100m ceiling missed a real "left Office" — GPS held at
 * 130-340m accuracy for about a minute mid-walk, near enough to normal that
 * a 150m-radius place should tolerate it). A fix noticeably less precise
 * than the boundary it is judging still cannot be trusted, so the ceiling
 * never drops below MIN_ACCURACY_FLOOR_M either.
 *
 * A phone lying still overnight must not announce trips (2026-09-26)
 * -------------------------------------------------------------------
 * Two consecutive fixes are not enough on their own. Indoors, with GPS lost,
 * the fused provider falls back to Wi-Fi and cell positions that can be
 * hundreds of metres or kilometres off yet report a modest accuracy, and they
 * stay wrong for minutes at a time. A sleeping member produced eight
 * "reached Office / left Office / reached Home / left Home" notices in half
 * an hour from exactly that. Because this class runs on every raw fix, the
 * push gate's jump check never saw them. So a crossing now also needs:
 *
 *   - motion: a GPS-quality fix that was actually moving (see MOVING_MPS)
 *     within MOTION_WINDOW_MS. A phone that has not moved cannot have crossed
 *     a boundary, however confident its last fix looks. Real arrivals and
 *     departures always involve a moving fix first;
 *   - dwell: the crossing must have persisted (ENTER_DWELL_MS / EXIT_DWELL_MS),
 *     not just repeated once;
 *   - cooldown: after a place changes state, the opposite change waits
 *     COOLDOWN_MS. It is deferred, not dropped, so a real quick return is
 *     still reported once the cooldown ends;
 *   - a plausible jump: a fix implying more than MAX_PLAUSIBLE_SPEED_MPS from
 *     the last trusted one is ignored, until it has persisted for
 *     JUMP_MAX_HOLD_MS so a real change of position is never ignored for good.
 *
 * All of that is in step() and isPlausibleMove(), which are pure and covered
 * by PlaceGeofenceTest.
 */
final class PlaceGeofence {

    /** Never MORE strict than this, however small a place's radius. */
    static final float MIN_ACCURACY_FLOOR_M = 100f;

    /** A GPS-quality fix at or above this speed is evidence the phone really moved. */
    static final float MOVING_MPS = 1.0f;
    /** Only fixes at least this accurate count as motion evidence; a coarse fix can invent a speed. */
    static final float MOTION_ACCURACY_M = 30f;
    /** How recent the last moving fix must be for a crossing to be believed. */
    static final long MOTION_WINDOW_MS = 5 * 60_000L;

    /** How long a crossing has to persist before it is reported. */
    static final long ENTER_DWELL_MS = 30_000L;
    static final long EXIT_DWELL_MS  = 90_000L;

    /** After a place changes state, the opposite change is held back this long. */
    static final long COOLDOWN_MS = 10 * 60_000L;

    /** Same plausibility ceiling as the push gate. */
    static final float MAX_PLAUSIBLE_SPEED_MPS = LocationFilter.MAX_PLAUSIBLE_SPEED_MPS;
    /** A position that keeps being an implausible jump is accepted after this long. */
    static final long JUMP_MAX_HOLD_MS = 3 * 60_000L;

    /** One saved place and the confirmation state machine tracking it. */
    static final class Place {
        final String id;
        final String name;
        final double lat;
        final double lng;
        final int radiusM;
        boolean insideConfirmed;
        boolean hasPending;
        boolean pendingInside;
        /** Fix time (elapsed realtime, ms) at which the pending crossing started. */
        long pendingSinceMs;
        /** Fix time of the last confirmed transition, or 0 if none yet. */
        long lastTransitionMs;

        Place(String id, String name, double lat, double lng, int radiusM, boolean insideConfirmed) {
            this.id = id;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radiusM = radiusM;
            this.insideConfirmed = insideConfirmed;
        }
    }

    /** A confirmed arrival or departure, ready to report to the server. */
    static final class Transition {
        final String placeId;
        final String placeName;
        final boolean entered;

        Transition(String placeId, String placeName, boolean entered) {
            this.placeId = placeId;
            this.placeName = placeName;
            this.entered = entered;
        }
    }

    private List<Place> places = new ArrayList<>();

    // The last position that was believed, and the time of the last fix that
    // showed real movement. Both use fix time (elapsed realtime), not the wall clock.
    private boolean hasAnchor = false;
    private double anchorLat, anchorLng;
    private long anchorMs = 0L;
    private long jumpHeldSinceMs = 0L;
    private long lastMotionMs = 0L;

    /**
     * Replaces the tracked places, e.g. after a refresh from the server.
     * Pending confirmation state for a place that still exists (by id) is
     * carried over rather than reset, so an in-flight crossing is not lost
     * to an unrelated refresh landing mid-way through confirming it.
     */
    void setPlaces(List<Place> newPlaces) {
        for (Place fresh : newPlaces) {
            for (Place existing : places) {
                if (existing.id.equals(fresh.id)) {
                    fresh.hasPending = existing.hasPending;
                    fresh.pendingInside = existing.pendingInside;
                    fresh.pendingSinceMs = existing.pendingSinceMs;
                    fresh.lastTransitionMs = existing.lastTransitionMs;
                    break;
                }
            }
        }
        places = newPlaces;
    }

    List<Place> getPlaces() {
        return places;
    }

    /** Feeds one fresh fix; returns any transitions it just confirmed — usually none. */
    List<Transition> checkFix(Location loc) {
        List<Transition> transitions = new ArrayList<>();
        if (loc == null || places.isEmpty()) return transitions;

        long nowMs = loc.getElapsedRealtimeNanos() / 1_000_000L;

        // Real movement, seen on any fix, before the accuracy or plausibility
        // gates below can drop it.
        if (loc.hasSpeed() && loc.getSpeed() >= MOVING_MPS
                && loc.hasAccuracy() && loc.getAccuracy() <= MOTION_ACCURACY_M) {
            lastMotionMs = nowMs;
        }

        // A teleporting fix is ignored rather than allowed to start a crossing.
        // Only fixes precise enough to be trusted take part, as the reference or
        // as the fix being judged: after a stretch of coarse Wi-Fi positions the
        // first good GPS fix can legitimately land a few hundred metres away, and
        // must not be mistaken for a jump.
        boolean precise = !loc.hasAccuracy() || loc.getAccuracy() <= MIN_ACCURACY_FLOOR_M;
        if (precise) {
            if (hasAnchor) {
                float[] moved = new float[1];
                Location.distanceBetween(anchorLat, anchorLng, loc.getLatitude(), loc.getLongitude(), moved);
                if (!isPlausibleMove(moved[0], nowMs - anchorMs)) {
                    if (jumpHeldSinceMs == 0L) jumpHeldSinceMs = nowMs;
                    if (nowMs - jumpHeldSinceMs < JUMP_MAX_HOLD_MS) return transitions;
                }
            }
            jumpHeldSinceMs = 0L;
            hasAnchor = true;
            anchorLat = loc.getLatitude();
            anchorLng = loc.getLongitude();
            anchorMs = nowMs;
        }

        for (Place p : places) {
            if (!accurateEnough(loc.hasAccuracy(), loc.getAccuracy(), p.radiusM)) continue;

            Location placeLoc = new Location("place");
            placeLoc.setLatitude(p.lat);
            placeLoc.setLongitude(p.lng);
            float distanceM = loc.distanceTo(placeLoc);

            Transition t = step(p, distanceM, loc.hasAccuracy(), loc.getAccuracy(), nowMs, lastMotionMs);
            if (t != null) transitions.add(t);
        }
        return transitions;
    }

    /**
     * True when covering movedM in elapsedMs is a believable speed. Pure.
     * A first fix, or a long gap, is always believable: the phone may simply
     * have been off, or on a plane.
     */
    static boolean isPlausibleMove(float movedM, long elapsedMs) {
        if (elapsedMs <= 0L) return movedM < 50f;
        float impliedMps = movedM / (elapsedMs / 1000f);
        return impliedMps <= MAX_PLAUSIBLE_SPEED_MPS;
    }

    /**
     * Applies one fix to one place. Mutates the place's pending state and
     * returns the transition if this fix confirms one, else null. Pure: no
     * Android types, no clock, so PlaceGeofenceTest drives it with made-up
     * times.
     *
     * @param distanceM      distance from the fix to the place's centre
     * @param nowMs          fix time (elapsed realtime)
     * @param lastMotionMs   fix time of the last GPS-quality moving fix, 0 if none
     */
    static Transition step(Place p, float distanceM, boolean hasAccuracy, float accuracyM,
                           long nowMs, long lastMotionMs) {
        boolean rawInside;
        if (p.insideConfirmed) {
            // To count as having left, the fix must be outside by more than its own error.
            float err = hasAccuracy ? accuracyM : 0f;
            rawInside = !(distanceM - err >= p.radiusM);
        } else {
            rawInside = distanceM <= p.radiusM;
        }

        boolean hadPending = p.hasPending;
        boolean hadPendingInside = p.pendingInside;
        Decision d = decide(p.insideConfirmed, p.hasPending, p.pendingInside, rawInside);

        if (!d.transitioned) {
            if (d.hasPending && (!hadPending || hadPendingInside != d.pendingInside)) {
                p.pendingSinceMs = nowMs;   // a new crossing starts counting now
            }
            p.hasPending = d.hasPending;
            p.pendingInside = d.pendingInside;
            return null;
        }

        // Two fixes agree. Before believing it, the phone must have moved, the
        // crossing must have lasted, and the place must not have just flipped.
        boolean entering = d.newInsideConfirmed;
        boolean moved = lastMotionMs != 0L && nowMs - lastMotionMs <= MOTION_WINDOW_MS;
        boolean dwelt = nowMs - p.pendingSinceMs >= (entering ? ENTER_DWELL_MS : EXIT_DWELL_MS);
        boolean coolingDown = p.lastTransitionMs != 0L && nowMs - p.lastTransitionMs < COOLDOWN_MS;

        if (!moved || !dwelt || coolingDown) {
            // Keep the crossing pending rather than dropping it, so a real one is
            // reported as soon as the missing condition is met.
            p.hasPending = true;
            p.pendingInside = rawInside;
            return null;
        }

        p.insideConfirmed = entering;
        p.hasPending = false;
        p.pendingInside = false;
        p.lastTransitionMs = nowMs;
        return new Transition(p.id, p.name, entering);
    }

    /**
     * A fix this imprecise cannot be trusted to say which side of THIS
     * place's boundary someone is on. The ceiling scales with the place's
     * own radius — a 140m-accurate fix says little about a 50m geofence, but
     * is still meaningful against a 150m one — floored at
     * MIN_ACCURACY_FLOOR_M so a tiny radius never gets an unreasonably loose
     * gate. Pure (no Android types beyond the primitives already read off
     * the Location) so it is testable on a plain JVM the same way decide()
     * is, without constructing a real Location.
     */
    static boolean accurateEnough(boolean hasAccuracy, float accuracyM, int radiusM) {
        return !hasAccuracy || accuracyM <= Math.max(MIN_ACCURACY_FLOOR_M, radiusM);
    }

    /** The outcome of applying one fix's raw reading to one place's state machine. */
    static final class Decision {
        final boolean hasPending;
        final boolean pendingInside;
        final boolean transitioned;
        final boolean newInsideConfirmed;

        Decision(boolean hasPending, boolean pendingInside, boolean transitioned, boolean newInsideConfirmed) {
            this.hasPending = hasPending;
            this.pendingInside = pendingInside;
            this.transitioned = transitioned;
            this.newInsideConfirmed = newInsideConfirmed;
        }
    }

    /**
     * Pure state machine for one place, one fix. No Android types: this is
     * the part that is actually tested (PlaceGeofenceTest), same reasoning
     * as LocationFilter#evaluate.
     */
    static Decision decide(boolean insideConfirmed, boolean hasPending, boolean pendingInside, boolean rawInside) {
        if (rawInside == insideConfirmed) {
            // Agrees with what is already believed — nothing to confirm.
            return new Decision(false, false, false, insideConfirmed);
        }
        if (hasPending && pendingInside == rawInside) {
            // Second fix in a row agrees with the crossing — confirmed.
            return new Decision(false, false, true, rawInside);
        }
        // First fix to disagree (or a stale pending pointing the other way) —
        // start, or restart, the pending count.
        return new Decision(true, rawInside, false, insideConfirmed);
    }
}
