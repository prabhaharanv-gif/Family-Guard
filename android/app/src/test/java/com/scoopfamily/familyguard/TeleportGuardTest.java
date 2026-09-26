package com.scoopfamily.familyguard;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The repeating 260m "cached fix" glitch that fired Reached/Left Home every few minutes. */
public class TeleportGuardTest {

    private static final long S = 1000L;
    private static final float NONE = TeleportGuard.NO_DISTANCE;

    @Test
    public void cachedPositionFromBefore_isStale() {
        assertTrue(TeleportGuard.isStale(5 * 60_000L));
        assertFalse(TeleportGuard.isStale(2 * S));
    }

    @Test
    public void farFixOnAStillPhone_isHeld() {
        TeleportGuard g = new TeleportGuard();
        assertTrue(g.shouldHold(true, 260f, 90 * S, false, NONE, 0L));
    }

    @Test
    public void glitchThatVanishesInSeconds_neverGetsThrough() {
        TeleportGuard g = new TeleportGuard();
        // The bad fix, delivered twice in the same instant (LAST_KNOWN + FUSED).
        assertTrue(g.shouldHold(true, 260f, 90 * S, false, NONE, 0L));
        assertTrue(g.shouldHold(true, 260f, 90 * S, false, 0f, 100L));
        // Five seconds later the real fix is back beside the last push.
        assertFalse(g.shouldHold(true, 3f, 95 * S, false, NONE, 5 * S));
        assertFalse(g.hasCandidate());
    }

    @Test
    public void realMove_thatPersists_isReleasedAfterTheConfirmWindow() {
        TeleportGuard g = new TeleportGuard();
        assertTrue(g.shouldHold(true, 260f, 90 * S, false, NONE, 0L));
        assertTrue(g.shouldHold(true, 262f, 100 * S, false, 4f, 10 * S));
        assertFalse(g.shouldHold(true, 262f, 110 * S, false, 4f, 21 * S));
    }

    @Test
    public void aFixElsewhere_restartsTheWait() {
        TeleportGuard g = new TeleportGuard();
        assertTrue(g.shouldHold(true, 260f, 90 * S, false, NONE, 0L));
        // 2 s later a far fix 640m from the first is not a continuation of it
        // (nothing travels that fast): a new candidate, the wait starts again.
        assertTrue(g.shouldHold(true, 900f, 100 * S, false, 640f, 2 * S));
        assertTrue(g.shouldHold(true, 900f, 110 * S, false, 3f, 12 * S));
        assertFalse(g.shouldHold(true, 900f, 120 * S, false, 3f, 22 * S));
    }

    @Test
    public void drivingWithPoorGps_isReleasedNotFrozen() {
        // No speed reading, so no motion evidence; a fix every 5 s, 80m apart
        // along a road. Each is a continuation of the last, so the wait runs
        // out at 20 s instead of restarting forever.
        TeleportGuard g = new TeleportGuard();
        assertTrue(g.shouldHold(true, 300f, 60 * S, false, NONE, 0L));
        assertTrue(g.shouldHold(true, 380f, 65 * S, false, 80f, 5 * S));
        assertTrue(g.shouldHold(true, 460f, 70 * S, false, 80f, 10 * S));
        assertTrue(g.shouldHold(true, 540f, 75 * S, false, 80f, 15 * S));
        assertFalse(g.shouldHold(true, 620f, 80 * S, false, 80f, 20 * S));
    }

    @Test
    public void recentMotion_vouchesForAJump() {
        TeleportGuard g = new TeleportGuard();
        assertFalse(g.shouldHold(true, 500f, 10 * S, true, NONE, 0L));
    }

    @Test
    public void smallMoves_andFirstFixes_andLongSilence_areNeverHeld() {
        TeleportGuard g = new TeleportGuard();
        assertFalse(g.shouldHold(true, 60f, 10 * S, false, NONE, 0L));
        assertFalse(g.shouldHold(false, 0f, 0L, false, NONE, 0L));
        assertFalse(g.shouldHold(true, 5000f, 20 * 60_000L, false, NONE, 0L));
    }
}
