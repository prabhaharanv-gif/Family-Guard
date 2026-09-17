package com.scoopfamily.familyguard;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

/**
 * Covers the moving/stationary cadence switch.
 *
 * The behaviour that matters for battery is that a still phone ends up on the
 * slow cadence; the behaviour that matters for safety is that it leaves the slow
 * cadence the moment the member actually moves, and that a pause at a junction
 * does not churn the location request.
 */
public class CadencePlanTest {

    private static final long STILL_AFTER_MS = 120_000L;

    private CadencePlan plan;
    private long now;

    @Before
    public void setUp() {
        plan = new CadencePlan(STILL_AFTER_MS);
        now  = 1_000_000L;
    }

    /** Advances the clock and feeds a fix in. */
    private boolean fix(boolean movedFar, boolean movingFast, long afterMs) {
        now += afterMs;
        return plan.update(movedFar, movingFast, now);
    }

    /**
     * Gets to the stationary cadence the only way it can be reached: one fix to
     * open the quiet window, then one past the far end of it. The window is
     * measured from the last movement — and the first fix counts as movement,
     * which is what keeps a freshly started service fast — so a single large
     * jump from setUp would not settle anything.
     */
    private void settle() {
        fix(false, false, 1_000);
        assertTrue("crossing the quiet window must switch the cadence",
            fix(false, false, STILL_AFTER_MS + 1));
        assertFalse("and it must then be on the slow cadence", plan.isMoving());
    }

    @Test
    public void startsOnTheFastCadence() {
        assertTrue("a service that has just started knows nothing yet, so it must start fast",
            plan.isMoving());
    }

    @Test
    public void stillPhone_dropsToStationaryOnceTheWindowPasses() {
        assertFalse("still inside the opening window", fix(false, false, 30_000));
        assertFalse("still inside the opening window", fix(false, false, 30_000));
        assertTrue("the opening window must keep it fast until it expires", plan.isMoving());

        assertTrue("crossing the quiet window must switch the cadence",
            fix(false, false, STILL_AFTER_MS + 1));
        assertFalse("and it must then be on the slow cadence", plan.isMoving());
    }

    @Test
    public void stationaryPhone_doesNotKeepRe_registering() {
        settle();

        for (int i = 0; i < 10; i++) {
            assertFalse("a still fix must not re-register the request",
                fix(false, false, 30_000));
        }
    }

    @Test
    public void movementAfterSettling_switchesBackImmediately() {
        settle();

        assertTrue("real displacement must switch back on the very next fix",
            fix(true, false, 30_000));
        assertTrue(plan.isMoving());
    }

    /**
     * The point of the speed input: at the slow cadence it can take two ticks to
     * accumulate MIN_MOVE_M, so a member starting a journey would be tracked
     * late. A fix reporting walking pace switches immediately instead.
     */
    @Test
    public void reportedSpeedAlone_switchesBack() {
        settle();

        assertTrue("speed alone is enough to count as moving",
            fix(false, true, 30_000));
        assertTrue(plan.isMoving());
    }

    /**
     * A red light is the case that would flap without hysteresis: stopped for
     * well under the quiet window, then moving again.
     */
    @Test
    public void briefStopAtAJunction_staysOnTheFastCadence() {
        fix(true, true, 5_000);                       // driving
        assertTrue(plan.isMoving());

        assertFalse("30s stopped is not stationary", fix(false, false, 30_000));
        assertFalse("60s stopped is still not stationary", fix(false, false, 30_000));
        assertTrue("and pulling away keeps it fast", plan.isMoving());

        assertFalse("moving again must not count as a change", fix(true, true, 10_000));
        assertTrue(plan.isMoving());
    }

    /**
     * Movement keeps pushing the quiet window out, so a continuous journey never
     * settles however long it lasts.
     */
    @Test
    public void continuousJourney_neverSettles() {
        for (int i = 0; i < 20; i++) {
            assertFalse("a moving fix must not change the cadence",
                fix(true, true, 60_000));
        }
        assertTrue(plan.isMoving());
    }
}
