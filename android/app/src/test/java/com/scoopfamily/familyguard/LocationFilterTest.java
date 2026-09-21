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
        return LocationFilter.evaluate(accuracy, NONE, true, moved, msSince, false, NONE, 0, 0);
    }

    private static LocationFilter.Result firstFix(float accuracy) {
        return LocationFilter.evaluate(accuracy, NONE, false, NONE, 0, false, NONE, 0, 0);
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
        // A precise (10m) fix: the flat MIN_MOVE_M floor is what applies.
        LocationFilter.Result r = evaluate(10f, LocationFilter.MIN_MOVE_M + 1f, 10_000);
        assertEquals(LocationFilter.Outcome.ACCEPTED, r.outcome);
    }

    // ── Accuracy-aware movement (2026-09-21) ─────────────────────────────────
    //
    // The field bug: a phone sitting indoors alternated between ~20m GPS fixes
    // and 60-100m Wi-Fi/cell guesses, and the pin flipped ~100m between the two.
    // Each Wi-Fi guess landed ~95m from the GPS pin, and the flat 15m rule read
    // that as movement.

    /** The exact Redmi case: a 100m-accurate fix 95m away is inside its own error. */
    @Test
    public void impreciseFix_withinItsOwnError_doesNotMoveThePin() {
        LocationFilter.Result r = LocationFilter.evaluate(
            100f, 20f, true, 95f, 10_000, false, NONE, 0, 0);

        assertEquals(LocationFilter.Outcome.SKIPPED_TOO_CLOSE, r.outcome);
        assertFalse(r.shouldPush());
    }

    @Test
    public void impreciseFix_beyondItsOwnError_isRealMovement() {
        LocationFilter.Result r = LocationFilter.evaluate(
            60f, 20f, true, 80f, 10_000, false, NONE, 0, 0);

        assertEquals("80m is more than a 60m fix can be wrong by",
            LocationFilter.Outcome.ACCEPTED, r.outcome);
    }

    @Test
    public void preciseFix_movingLessThanItsError_isSkipped() {
        LocationFilter.Result r = evaluate(20f, 18f, 10_000);
        assertEquals(LocationFilter.Outcome.SKIPPED_TOO_CLOSE, r.outcome);
    }

    /** A rough pin (100m) is corrected by a much better fix even on a small move. */
    @Test
    public void muchMorePreciseFix_correctsTheRoughPin() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, 100f, true, 18f, 10_000, false, NONE, 0, 0);

        assertEquals(LocationFilter.Outcome.ACCEPTED, r.outcome);
        assertTrue(r.detail.contains("more precise"));
    }

    @Test
    public void slightlyMorePreciseFix_isNotAnUpgrade() {
        LocationFilter.Result r = LocationFilter.evaluate(
            40f, 60f, true, 20f, 10_000, false, NONE, 0, 0);
        assertEquals(LocationFilter.Outcome.SKIPPED_TOO_CLOSE, r.outcome);
    }

    /** Heartbeat with a worse fix: refresh the timestamp, keep the better position. */
    @Test
    public void heartbeat_withAWorseFix_keepsTheLastPosition() {
        LocationFilter.Result r = LocationFilter.evaluate(
            90f, 20f, true, 50f, LocationFilter.HEARTBEAT_MS, false, NONE, 0, 0);

        assertEquals(LocationFilter.Outcome.ACCEPTED_HEARTBEAT, r.outcome);
        assertTrue("the pin must stay alive", r.shouldPush());
        assertTrue("but not move onto the worse fix", r.keepLastPosition);
    }

    @Test
    public void heartbeat_withAsGoodAFix_pushesThatFix() {
        LocationFilter.Result r = LocationFilter.evaluate(
            15f, 20f, true, 5f, LocationFilter.HEARTBEAT_MS, false, NONE, 0, 0);

        assertEquals(LocationFilter.Outcome.ACCEPTED_HEARTBEAT, r.outcome);
        assertFalse(r.keepLastPosition);
    }

    /**
     * Replay of the Redmi indoors for ten minutes: a 20m pin, then Wi-Fi guesses
     * of 60-100m landing 60-95m away every 10s. Before the fix several of these
     * were pushed; now none may move the pin, and every heartbeat keeps it.
     */
    @Test
    public void indoorWifiGuesses_neverWalkAStillPin() {
        float[][] fixes = { {100f, 95f}, {80f, 75f}, {95f, 90f}, {70f, 62f}, {100f, 95.4f}, {85f, 80f} };
        long sinceLastPush = 0;
        for (int i = 0; i < 60; i++) {
            float[] f = fixes[i % fixes.length];
            sinceLastPush += 10_000;
            LocationFilter.Result r = LocationFilter.evaluate(
                f[0], 20f, true, f[1], sinceLastPush, false, NONE, 0, 0);
            if (r.outcome == LocationFilter.Outcome.ACCEPTED) {
                throw new AssertionError("fix " + i + " (" + f[0] + "m acc, " + f[1] + "m away) moved the pin");
            }
            if (r.shouldPush()) {
                assertTrue("heartbeat " + i + " must keep the 20m position", r.keepLastPosition);
                sinceLastPush = 0;
            }
        }
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
            20f, NONE, true, 5000f, 2_000,
            true, LocationFilter.JUMP_CONFIRM_RADIUS_M - 1f, 2_000, 2_000);

        assertTrue("real fast travel confirms itself", r.shouldPush());
        assertTrue(r.clearPendingJump);
        assertTrue("the confirmation should be visible in the log",
            r.note != null && r.note.contains("jump confirmed"));
    }

    /** 5km from the held fix 2s later — the two wild fixes disagree with each other too. */
    @Test
    public void heldJump_isNotAcceptedWhenTheSecondFixIsElsewhere() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, NONE, true, 5000f, 2_000,
            true, 5000f, 2_000, 2_000);

        assertEquals("a second wild fix is not a confirmation",
            LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
        assertTrue(r.holdAsPendingJump);
    }

    @Test
    public void normalTravel_clearsAnyHeldJump() {
        LocationFilter.Result r = LocationFilter.evaluate(
            20f, NONE, true, 100f, 10_000, true, 9999f, 5_000, 5_000);

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

    // ── Travelling after a GPS dropout ───────────────────────────────────────
    //
    // The field bug (2026-09-17): a member on a bike at up to 100 km/h showed a
    // pin 20km behind for the whole ride while Google Find Hub tracked the phone.
    // A short dropout left the last push >1.1km behind, which the clamped speed
    // check reads as a jump; each later fix was ~140m from the held one, never
    // inside the 50m confirm radius, so every fix was rejected until she stopped.

    /** One fix of a bike at 100 km/h, 5s after the held one, 1.5km past the last push. */
    @Test
    public void bikeAt100kmh_afterADropout_isConfirmedByTheNextFix() {
        LocationFilter.Result r = LocationFilter.evaluate(
            15f, NONE, true, 1500f, 60_000,
            true, 139f, 5_000, 5_000);

        assertTrue("a believable next fix confirms the journey", r.shouldPush());
        assertTrue(r.clearPendingJump);
    }

    @Test
    public void heldFixesInTheSameInstant_doNotDivideByZero() {
        LocationFilter.Result r = LocationFilter.evaluate(
            15f, NONE, true, 5000f, 2_000,
            true, 5000f, 0, 0);

        assertEquals(LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
    }

    @Test
    public void rejectingForAMinute_acceptsRatherThanFreezeThePin() {
        // 1km from the held fix in 5s is ~720 km/h — the fixes disagree — but a
        // minute of rejecting accurate fixes is hiding a position, not noise.
        LocationFilter.Result r = LocationFilter.evaluate(
            15f, NONE, true, 5000f, 70_000,
            true, 1000f, 5_000, LocationFilter.JUMP_MAX_HOLD_MS);

        assertTrue(r.shouldPush());
        assertTrue(r.clearPendingJump);
        assertTrue(r.note != null && r.note.contains("rather than freezing"));
    }

    @Test
    public void rejectingForUnderAMinute_stillHolds() {
        LocationFilter.Result r = LocationFilter.evaluate(
            15f, NONE, true, 5000f, 70_000,
            true, 1000f, 5_000, LocationFilter.JUMP_MAX_HOLD_MS - 1);

        assertEquals(LocationFilter.Outcome.REJECTED_JUMP, r.outcome);
    }

    /** Car and bike speeds, each with a dropout long enough to trip the jump gate. */
    @Test
    public void journeysAfterADropout_keepThePinWithTheRider() {
        int[][] kmhAndDropoutS = { { 50, 90 }, { 72, 60 }, { 90, 45 }, { 100, 60 }, { 120, 120 } };
        for (int[] c : kmhAndDropoutS) {
            Trip trip = ride(c[0] / 3.6, c[1] * 1000L, 5_000L, 30 * 60_000L);
            assertTrue(c[0] + " km/h with a " + c[1] + "s dropout left the pin "
                    + Math.round(trip.lagM) + "m behind",
                trip.lagM < 500);
        }
    }

    /** A single wild fix while standing still must never reach the map. */
    @Test
    public void aTeleportThatSnapsBack_isNeverPushed() {
        Trip trip = new Trip();
        long t = 0;
        for (; t <= 60_000; t += 5_000) trip.fix(t, 0, 10f);
        trip.fix(t += 5_000, 5_000, 10f);           // teleport 5km
        for (int i = 0; i < 12; i++) trip.fix(t += 5_000, 0, 10f);

        assertEquals("the pin never left home", 0.0, trip.maxPushedM, 0.001);
    }

    // ── A one-dimensional replay of LocationForegroundService.handleLocation ──

    /** Standing still for a minute, then riding at `mps`, losing GPS for `dropoutMs`. */
    private static Trip ride(double mps, long dropoutMs, long stepMs, long durationMs) {
        Trip trip = new Trip();
        long rideStart = 60_000, dropoutStart = rideStart + 30_000;
        for (long t = 0; t <= durationMs; t += stepMs) {
            double pos = t < rideStart ? 0 : (t - rideStart) / 1000.0 * mps;
            boolean dropout = t > dropoutStart && t <= dropoutStart + dropoutMs;
            trip.fix(t, pos, dropout ? 300f : 10f);
            trip.lagM = pos - trip.pushedM;
        }
        return trip;
    }

    /** Keeps the same state the service keeps, and applies verdicts the same way. */
    private static final class Trip {
        boolean hasPush; double pushedM, maxPushedM; long pushT;
        Double pendingM; long pendingT, holdStartT;
        double lagM;

        void fix(long t, double posM, float accuracy) {
            boolean hasPending = pendingM != null;
            LocationFilter.Result r = LocationFilter.evaluate(
                accuracy, NONE, hasPush,
                hasPush ? (float) Math.abs(posM - pushedM) : NONE,
                hasPush ? t - pushT : 0,
                hasPending,
                hasPending ? (float) Math.abs(posM - pendingM) : NONE,
                hasPending ? t - pendingT : 0,
                hasPending ? t - holdStartT : 0);
            if (r.holdAsPendingJump) {
                if (pendingM == null) holdStartT = t;
                pendingM = posM; pendingT = t;
            } else if (r.clearPendingJump) {
                pendingM = null;
            }
            if (r.shouldPush()) {
                hasPush = true; pushedM = posM; pushT = t;
                maxPushedM = Math.max(maxPushedM, Math.abs(posM));
            }
        }
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
