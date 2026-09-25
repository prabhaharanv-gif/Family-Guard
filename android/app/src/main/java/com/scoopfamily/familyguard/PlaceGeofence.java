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
 */
final class PlaceGeofence {

    /** Never MORE strict than this, however small a place's radius. */
    static final float MIN_ACCURACY_FLOOR_M = 100f;

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

        for (Place p : places) {
            if (!accurateEnough(loc.hasAccuracy(), loc.getAccuracy(), p.radiusM)) continue;

            Location placeLoc = new Location("place");
            placeLoc.setLatitude(p.lat);
            placeLoc.setLongitude(p.lng);
            boolean rawInside = loc.distanceTo(placeLoc) <= p.radiusM;

            Decision d = decide(p.insideConfirmed, p.hasPending, p.pendingInside, rawInside);
            p.hasPending = d.hasPending;
            p.pendingInside = d.pendingInside;
            if (d.transitioned) {
                p.insideConfirmed = d.newInsideConfirmed;
                transitions.add(new Transition(p.id, p.name, d.newInsideConfirmed));
            }
        }
        return transitions;
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
