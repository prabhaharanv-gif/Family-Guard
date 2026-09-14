package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers the gates that decide whether a family member's pin moves.
 *
 * The stakes are asymmetric and worth stating: a fix wrongly discarded makes
 * someone look like they stopped sharing, and a bad fix wrongly accepted makes
 * their pin teleport. Both have been seen in this app, which is why the gates
 * exist at all.
 */
public class LocationFilterTest {

    private static final float NONE = LocationFilter.NO_DISTANCE;

    /** The common case: a good fix, a baseline, nothing held. */
    private static LocationFilter.Result evaluate(float accuracy, float moved, long msSince) {
        return LocationFilter.evaluate(accuracy, true, moved, msSince, false, NONE);
    }

    private static LocationFilter.Result firstFix(float accuracy) {
        return LocationFilter.evaluate(accuracy, false, NONE, 0, false, NONE);
    }

    // ── Accuracy gate ────────────────────────────────────────────────────────

    @Test
    public void preciseFix_isAccepted() {
        assertTrue(evaluate(20f, 100f, 10_000).shouldPush());
    }

    @Test
    public void impreciseFix_isDiscarded() {
        LocationFilter.Result r = evaluate(LocationFilter.MAX_ACCURACY_M + 1f, 100f, 10_000);

        assertEquals(LocationFilter.Outcome.DISCARDED_ACCURACY, r.outcome);
        assertFalse(r.shouldPush());
    }

    @Test
    public void fixExactlyAtTheAccuracyLimit_isAccepted() {
        assertTrue("the limit is a ceiling, not an exclusion",
            evaluate(LocationFilter.MAX_ACCURACY_M, 100f, 10_000).shouldPush());
    }

    /**
     * Indoors the first fix is routinely worse than 100m. Rejecting it leaves a
     * member with no row in `locations` at all, which the Family list draws as
     * "not sharing" — so a rough first position beats none.
     */
    @Test
    public void firstFix_acceptsFarWorseAccuracy() {
        float tooRoughLater = LocationFilter.MAX_ACCURACY_M + 500f;

        assertTrue("a rough first fix must get through", firstFix(tooRoughLater).shouldPush());
        assertFalse("but the same accuracy must be rejected once a baseline exists",
            evaluate(tooRoughLater, 100f, 10_000).shouldPush());
    }

    @Test
    public void firstFix_stillHasAnUpperBound() {
        assertFalse("even the first fix has a limit",
            firstFix(LocationFilter.FIRST_FIX_ACCURACY_M + 1f).shouldPush());
    }

    @Test
    public void firstFix_skipsTheMovementGates() {
        LocationFilter.Result r = firstFix(50f);

        assertEquals(LocationFilter.Outcome.ACCEPTED, r.outcome);
        assertTrue("the first fix has nothing to be measured against",
            r.detail.contains("first fix"));
    }

    // ── Distance gate ────────────────────────────────────────────────────────

    @Test
    public void movingFarEnough_isAccepted() {
        LocationFilter.Result r = evaluate(20f, LocationFilter.MIN_MOVE_M + 1f, 10_000);
        assertEquals(LocationFilter.Outcome.ACCEPTED, r.outcome);
    }

    @Test
    public void barelyMoving_isSkipped() {
        LocationFilter.Result r = evaluate(20f, LocationFilter.MIN_MOVE_M - 1f, 10_000);

        assertEquals(LocationFilter.Outcome.SKIPPED_TOO_CLOSE, r.outcome);
        assertFalse(r.shouldPush());
    }

    /**
     * A stationary member must still be pushed occasionally or their pin goes
     * stale and they look like they dropped off.
     */
    @Test
    public void stationaryPastTheHeartbeat_isPushedAnyway() {
        LocationFilter.Result r = evaluate(20f, 1f, LocationFilter.HEARTBEAT_MS);

        assertEquals(LocationFilter.Outcome.ACCEPTED_HEARTBEAT, r.outcome);
        assertTrue("a stale pin is worse than a redundant push", r.shouldPush());
    }

    @Test
    public void stationaryBeforeTheHeartbeat_isNotPushed() {
        LocationFilter.Result r = evaluate(20f, 1f, LocationFilter.HEARTBEAT_MS - 1);
        assertEquals(LocationFilter.Outcome.SKIPPED_TOO_CLOSE, r.outcome);
    }

    // ── Jump gate ────────────────────────────────────────────────────────────

    /** 5km in 2s is roughly 9000 km/h. */
    @Test
    public void impossibleJump_isHeldNotPushed() {
        LocationFilter.Result r = evaluate(20f, 5000f, 2_000);

        assertEquals(LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
        assertFalse("a teleporting pin must never be pushed", r.shouldPush());
        assertTrue("the fix must be kept so a second one can confirm it", r.holdAsPendingJump);
    }

    @Test
    public void heldJump_isAcceptedWhenASecondFixAgrees() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, true, 5000f, 2_000,
            true, LocationFilter.JUMP_CONFIRM_RADIUS_M - 1f);

        assertTrue("real fast travel confirms itself", r.shouldPush());
        assertTrue(r.clearPendingJump);
        assertTrue("the confirmation should be visible in the log",
            r.note != null && r.note.contains("jump confirmed"));
    }

    @Test
    public void heldJump_isNotAcceptedWhenTheSecondFixIsElsewhere() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, true, 5000f, 2_000,
            true, LocationFilter.JUMP_CONFIRM_RADIUS_M + 1f);

        assertEquals("a second wild fix is not a confirmation",
            LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
        assertTrue(r.holdAsPendingJump);
    }

    @Test
    public void normalTravel_clearsAnyHeldJump() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, true, 100f, 10_000, true, 9999f);

        assertTrue("a plausible fix means the held one was noise", r.clearPendingJump);
        assertTrue(r.shouldPush());
    }

    @Test
    public void fastButPlausibleTravel_isAccepted() {
        // 50 m/s ≈ 180 km/h — a train, under the 55 m/s ceiling.
        LocationFilter.Result r = evaluate(20f, 500f, 10_000);

        assertTrue("genuine fast travel must not be blocked", r.shouldPush());
        assertEquals(LocationFilter.Outcome.ACCEPTED, r.outcome);
    }

    /**
     * The reason SPEED_CLAMP_MS exists. Measured against a 90s stationary
     * baseline, a 5km jump implies only 200 km/h and would sail through — even
     * though the person never moved. Clamping the elapsed time keeps the speed
     * check honest.
     */
    @Test
    public void jumpAfterAStaleBaseline_isStillCaught() {
        LocationFilter.Result r = evaluate(20f, 5000f, 90_000);

        assertEquals("a stale baseline must not launder a teleport",
            LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
    }

    @Test
    public void zeroElapsedTime_doesNotDivideByZero() {
        LocationFilter.Result r = evaluate(20f, 5000f, 0);

        assertEquals("no elapsed time means no speed to judge",
            LocationFilter.Outcome.ACCEPTED, r.outcome);
    }

    // ── Ordering ─────────────────────────────────────────────────────────────

    /**
     * Accuracy is checked first on purpose: a wildly imprecise fix should be
     * thrown away outright, not held as a jump candidate that a later fix could
     * confirm.
     */
    @Test
    public void imprecisionBeatsJumpDetection() {
        LocationFilter.Result r = evaluate(LocationFilter.MAX_ACCURACY_M + 1f, 5000f, 1_000);

        assertEquals(LocationFilter.Outcome.DISCARDED_ACCURACY, r.outcome);
        assertFalse("a discarded fix must not become a jump candidate", r.holdAsPendingJump);
    }

    @Test
    public void aRejectedJumpIsNotAlsoJudgedOnDistance() {
        LocationFilter.Result r = evaluate(20f, 5000f, 1_000);
        assertEquals(LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
    }

    @Test
    public void everyResultExplainsItself() {
        LocationFilter.Result[] results = {
            firstFix(50f),
            evaluate(20f, 100f, 10_000),
            evaluate(999f, 100f, 10_000),
            evaluate(20f, 1f, 1_000),
            evaluate(20f, 5000f, 1_000),
        };
        for (LocationFilter.Result r : results) {
            assertTrue("a result with no detail is useless in a log",
                r.detail != null && !r.detail.isEmpty());
        }
    }
}
