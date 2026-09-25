package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers PlaceGeofence's confirmation state machine: whether one noisy fix
 * at a boundary can fire a false "reached"/"left", and whether a real
 * crossing is confirmed within two fixes as intended.
 */
public class PlaceGeofenceTest {

    // ── Agreement with the current state ─────────────────────────────────────

    @Test
    public void rawReadingAgreesWithConfirmedState_doesNothing() {
        PlaceGeofence.Decision d = PlaceGeofence.decide(true, false, false, true);

        assertFalse(d.transitioned);
        assertFalse(d.hasPending);
        assertEquals(true, d.newInsideConfirmed);
    }

    @Test
    public void outsideStaysOutsideWhileFixesAgree() {
        PlaceGeofence.Decision d = PlaceGeofence.decide(false, false, false, false);

        assertFalse(d.transitioned);
        assertFalse(d.hasPending);
    }

    // ── A single disagreeing fix is not enough ───────────────────────────────

    @Test
    public void firstDisagreeingFix_startsPendingButDoesNotTransition() {
        // Confirmed outside, one fix now says inside.
        PlaceGeofence.Decision d = PlaceGeofence.decide(false, false, false, true);

        assertFalse("a single noisy fix must not fire a transition alone", d.transitioned);
        assertTrue(d.hasPending);
        assertTrue(d.pendingInside);
        assertEquals("state has not actually changed yet", false, d.newInsideConfirmed);
    }

    @Test
    public void singleNoisyFixAtTheEdge_cannotFlipStateByItself() {
        // Confirmed inside; one noisy fix says outside; nothing confirms it.
        PlaceGeofence.Decision first = PlaceGeofence.decide(true, false, false, false);
        assertFalse(first.transitioned);

        // GPS wobbles back the very next fix — the pending crossing never repeats.
        PlaceGeofence.Decision second = PlaceGeofence.decide(true, first.hasPending, first.pendingInside, true);
        assertFalse("the wobble-back agrees with the ORIGINAL confirmed state, not the pending one",
            second.transitioned);
        assertFalse("agreeing with the confirmed state clears the pending crossing", second.hasPending);
    }

    // ── Two agreeing fixes confirm the crossing ──────────────────────────────

    @Test
    public void twoConsecutiveAgreeingFixes_confirmArrival() {
        PlaceGeofence.Decision first = PlaceGeofence.decide(false, false, false, true);
        assertFalse(first.transitioned);

        PlaceGeofence.Decision second = PlaceGeofence.decide(false, first.hasPending, first.pendingInside, true);

        assertTrue("second agreeing fix confirms the arrival", second.transitioned);
        assertTrue(second.newInsideConfirmed);
        assertFalse("confirmed — nothing left pending", second.hasPending);
    }

    @Test
    public void twoConsecutiveAgreeingFixes_confirmDeparture() {
        PlaceGeofence.Decision first = PlaceGeofence.decide(true, false, false, false);
        assertFalse(first.transitioned);

        PlaceGeofence.Decision second = PlaceGeofence.decide(true, first.hasPending, first.pendingInside, false);

        assertTrue(second.transitioned);
        assertFalse("confirmed departure", second.newInsideConfirmed);
    }

    @Test
    public void pendingCrossingThatReversesDirection_restartsInsteadOfConfirming() {
        // Confirmed outside; a fix suggests inside...
        PlaceGeofence.Decision first = PlaceGeofence.decide(false, false, false, true);
        assertTrue(first.hasPending);
        assertTrue(first.pendingInside);

        // ...then the next fix ALSO disagrees with confirmed, but in a way that
        // still says "inside" is wrong too — here: back to outside, which just
        // agrees with the original confirmed state, so it clears pending rather
        // than confirming anything.
        PlaceGeofence.Decision second = PlaceGeofence.decide(false, first.hasPending, first.pendingInside, false);
        assertFalse(second.transitioned);
        assertFalse(second.hasPending);
    }

    // ── Accuracy gate ─────────────────────────────────────────────────────────
    // Pure by construction (see PlaceGeofence#accurateEnough) specifically so
    // it is testable here without constructing a real android.location.Location
    // — this project's unit tests run on a plain JVM with no Robolectric, and
    // Location's setters throw "not mocked" (confirmed by hand before settling
    // on this split; same reason LocationFilter takes distances as parameters
    // instead of Location objects).

    @Test
    public void fixExactlyAtTheFloor_passesForASmallRadius() {
        // A 50m-radius place still only tolerates the MIN_ACCURACY_FLOOR_M
        // floor, not something looser.
        assertTrue("the limit is a ceiling, not an exclusion",
            PlaceGeofence.accurateEnough(true, PlaceGeofence.MIN_ACCURACY_FLOOR_M, 50));
    }

    @Test
    public void fixWorseThanTheFloor_isRejectedForASmallRadius() {
        assertFalse(PlaceGeofence.accurateEnough(true, PlaceGeofence.MIN_ACCURACY_FLOOR_M + 1f, 50));
    }

    @Test
    public void fixWithNoReportedAccuracy_isAllowedThrough() {
        // hasAccuracy() false means the platform did not report one at all —
        // treated as acceptable rather than discarded, same spirit as
        // LocationFilter letting a rough first fix through rather than
        // leaving a member looking unreachable.
        assertTrue(PlaceGeofence.accurateEnough(false, 99999f, 150));
    }

    // ── Accuracy gate scales with the place's own radius ─────────────────────
    // Added 2026-09-23 after a device test: a flat 100m ceiling missed a real
    // "left Office" when GPS accuracy held at 130-340m for about a minute
    // mid-walk — close enough to normal that a 150m-radius place should not
    // have discarded all of it.

    @Test
    public void largeRadiusPlace_toleratesAccuracyWorseThanTheFloor() {
        // 140m accuracy against a 150m radius is still meaningful — the gate
        // must not clip it down to the 100m floor.
        assertTrue(PlaceGeofence.accurateEnough(true, 140f, 150));
    }

    @Test
    public void largeRadiusPlace_stillRejectsAccuracyWorseThanItsOwnRadius() {
        // The gate scales up, it does not disappear: 340m accuracy told
        // nothing useful about a 150m boundary in the actual device test.
        assertFalse(PlaceGeofence.accurateEnough(true, 340f, 150));
    }

    @Test
    public void smallRadiusPlace_neverLoosensBelowTheFloor() {
        // A 30m-radius place does not get an even STRICTER gate than 100m —
        // the floor is a floor, not a second, tighter ceiling.
        assertTrue(PlaceGeofence.accurateEnough(true, 95f, 30));
    }
}
