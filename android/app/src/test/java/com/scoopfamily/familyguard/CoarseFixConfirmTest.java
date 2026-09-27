package com.scoopfamily.familyguard;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** A run of poor fixes is believed only when the fixes keep agreeing with each other. */
public class CoarseFixConfirmTest {

    private static final float NONE = CoarseFixConfirm.NO_DISTANCE;

    @Test
    public void aSinglePoorFix_isNeverBelieved() {
        assertFalse(new CoarseFixConfirm().offer(150f, NONE, NONE, 0L));
    }

    @Test
    public void twoAgreeingFixesUnder200m_areBelievedOnceTwentySecondsHavePassed() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        assertFalse(c.offer(150f, NONE, NONE, 0L));
        assertFalse("agrees but too soon", c.offer(140f, 30f, 150f, 10_000L));
        assertTrue(c.offer(140f, 30f, 140f, 25_000L));
    }

    @Test
    public void fixesOver200m_needThreeReadsAndFortyFiveSeconds() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        assertFalse(c.offer(280f, NONE, NONE, 0L));
        assertFalse(c.offer(270f, 40f, 280f, 25_000L));
        assertFalse("two reads is not enough at this accuracy", c.offer(270f, 40f, 270f, 40_000L));
        assertTrue(c.offer(260f, 40f, 270f, 50_000L));
    }

    @Test
    public void fixesThatDisagree_startOverEachTime_soAWanderingGuessNeverConfirms() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        long t = 0;
        for (int i = 0; i < 10; i++) {
            // Each fix lands 400m from the last, outside both accuracies.
            assertFalse(c.offer(150f, i == 0 ? NONE : 400f, 150f, t));
            t += 15_000L;
        }
    }

    @Test
    public void aLongGapEndsTheRun() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        c.offer(150f, NONE, NONE, 0L);
        assertFalse("the old run is over, this is read 1 of a new one",
            c.offer(150f, 10f, 150f, 5 * 60_000L));
    }

    @Test
    public void nothingWorseThan500m_isEverBelieved() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        long t = 0;
        for (int i = 0; i < 6; i++) {
            assertFalse(c.offer(501f, i == 0 ? NONE : 5f, 501f, t));
            t += 30_000L;
        }
    }

    @Test
    public void resetForgetsTheRun() {
        CoarseFixConfirm c = new CoarseFixConfirm();
        c.offer(150f, NONE, NONE, 0L);
        c.reset();
        assertFalse(c.isActive());
        assertFalse(c.offer(150f, 10f, 150f, 25_000L));
    }
}
