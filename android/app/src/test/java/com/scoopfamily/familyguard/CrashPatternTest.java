package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The crash rule decides whether a family gets woken by an automatic SOS
 * countdown, so both directions matter: it must fire for a real crash, and it
 * must stay quiet for everything that merely looks like one.
 */
public class CrashPatternTest {

    private static final float G = 9.80665f;

    /** A sample whose magnitude is `g` (all on one axis). */
    private static void hit(CrashPattern p, long t, float g) {
        p.onAccel(t, 0f, 0f, g * G);
    }

    @Test
    public void realCrash_impactThenStop_isRecognised() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 55f);
        hit(p, 3_000, 12f);
        assertTrue("stopped 4s after the impact", p.onSpeed(7_000, 2f));
    }

    @Test
    public void crash_isReportedOnlyOnce() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 55f);
        hit(p, 3_000, 12f);
        assertTrue(p.onSpeed(7_000, 2f));
        assertFalse("the next slow fix is the same event", p.onSpeed(12_000, 0f));
    }

    @Test
    public void pothole_belowTheImpactThreshold_isIgnored() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 50f);
        hit(p, 3_000, 4.2f);
        assertFalse(p.onSpeed(7_000, 1f));
    }

    @Test
    public void impactWhileSlow_isNotACrash() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 12f);        // walking pace or crawling
        hit(p, 3_000, 15f);           // dropped phone
        assertFalse(p.onSpeed(6_000, 0f));
    }

    @Test
    public void phoneDroppedInACarThatKeepsDriving_isNotACrash() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        hit(p, 3_000, 20f);
        assertFalse(p.onSpeed(6_000, 58f));
        assertFalse(p.onSpeed(11_000, 61f));
        assertFalse("and the pending impact times out", p.onSpeed(20_000, 0f));
    }

    @Test
    public void stopLongAfterTheImpact_isNotConfirmed() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        hit(p, 3_000, 9f);
        assertFalse("stopped after the confirm window", p.onSpeed(3_000 + CrashPattern.CONFIRM_WINDOW_MS + 1, 0f));
    }

    @Test
    public void ordinaryHardStop_withoutAnImpact_isNotACrash() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        assertFalse(p.onSpeed(6_000, 5f));
    }

    @Test
    public void staleSpeed_doesNotCountAsDriving() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        hit(p, 1_000 + CrashPattern.SPEED_FRESH_MS + 1, 12f);   // no fix for 15s+
        assertFalse(p.onSpeed(30_000, 0f));
    }

    @Test
    public void secondCrashWithinTheCooldown_isSuppressed() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        hit(p, 3_000, 12f);
        assertTrue(p.onSpeed(7_000, 0f));

        p.onSpeed(60_000, 50f);
        hit(p, 62_000, 12f);
        assertFalse("still inside the ten minutes", p.onSpeed(66_000, 0f));
    }

    @Test
    public void crashAfterTheCooldown_isRecognisedAgain() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 60f);
        hit(p, 3_000, 12f);
        assertTrue(p.onSpeed(7_000, 0f));

        long later = 7_000 + CrashPattern.COOLDOWN_MS + 1_000;
        p.onSpeed(later, 60f);
        hit(p, later + 2_000, 12f);
        assertTrue(p.onSpeed(later + 6_000, 0f));
    }

    @Test
    public void drivingAt_followsTheLatestFreshSpeed() {
        CrashPattern p = new CrashPattern();
        assertFalse(p.drivingAt(0));
        p.onSpeed(1_000, 45f);
        assertTrue(p.drivingAt(5_000));
        assertFalse("speed too old", p.drivingAt(1_000 + CrashPattern.SPEED_FRESH_MS + 1));
        p.onSpeed(20_000, 8f);
        assertFalse("stopped", p.drivingAt(21_000));
    }

    @Test
    public void biggestJoltOfTheEventIsKept() {
        CrashPattern p = new CrashPattern();
        p.onSpeed(1_000, 55f);
        hit(p, 3_000, 7f);
        hit(p, 3_010, 18f);
        hit(p, 3_020, 9f);
        assertEquals(18f, p.pendingImpactG(), 0.01f);
    }
}
