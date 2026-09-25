package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The timing rules of Phone lost mode. */
public class LostModePlanTest {

    private static final long NOW = 1_000_000_000L;

    @Test
    public void serverDeadline_isUsed_whenReasonable() {
        long until = NOW + 3 * 3600_000L;
        assertEquals(until, LostModePlan.deadline(NOW, until));
    }

    @Test
    public void absurdDeadline_isCappedAtTwelveHours() {
        assertEquals(NOW + LostModePlan.MAX_MS, LostModePlan.deadline(NOW, NOW + 10 * 24 * 3600_000L));
    }

    @Test
    public void missingOrPastDeadline_fallsBackToTheCap() {
        assertEquals(NOW + LostModePlan.MAX_MS, LostModePlan.deadline(NOW, 0));
        assertEquals(NOW + LostModePlan.MAX_MS, LostModePlan.deadline(NOW, NOW - 5));
    }

    @Test
    public void isActiveOnlyBeforeTheDeadline() {
        long until = NOW + 1000;
        assertTrue(LostModePlan.active(NOW, until));
        assertFalse(LostModePlan.active(NOW + 1000, until));
        assertFalse("never started", LostModePlan.active(NOW, 0));
    }

    @Test
    public void ringsEveryTwoMinutes_notContinuously() {
        long until = NOW + 3600_000L;
        assertTrue("first ring straight away", LostModePlan.shouldRing(NOW, until, 0));
        assertFalse(LostModePlan.shouldRing(NOW + 60_000L, until, NOW));
        assertTrue(LostModePlan.shouldRing(NOW + LostModePlan.RING_EVERY_MS, until, NOW));
    }

    @Test
    public void neverRingsOnceLostModeIsOver() {
        long until = NOW + 1000;
        assertFalse(LostModePlan.shouldRing(NOW + 500_000L, until, 0));
        assertFalse(LostModePlan.shouldForcePush(NOW + 500_000L, until, 0));
    }

    @Test
    public void reportsPositionEveryTenSeconds_evenWhenStill() {
        long until = NOW + 3600_000L;
        assertFalse(LostModePlan.shouldForcePush(NOW + 5_000L, until, NOW));
        assertTrue(LostModePlan.shouldForcePush(NOW + LostModePlan.PUSH_EVERY_MS, until, NOW));
    }
}
