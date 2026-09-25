package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The rule that turns wrong passwords into a report to the family. */
public class UnlockAttemptPlanTest {

    private static UnlockAttemptPlan.State fail(UnlockAttemptPlan.State s, long t) {
        return UnlockAttemptPlan.onFailed(s, t);
    }

    @Test
    public void twoFailures_areNotReported() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        s = fail(s, 1_000);
        assertFalse(s.report);
        s = fail(s, 5_000);
        assertFalse(s.report);
    }

    @Test
    public void thirdFailureInARow_isReported_withTheCount() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        s = fail(s, 1_000);
        s = fail(s, 5_000);
        s = fail(s, 9_000);
        assertTrue(s.report);
        assertEquals(3, s.attempts);
    }

    @Test
    public void correctUnlock_endsTheRun() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        s = fail(s, 1_000);
        s = fail(s, 5_000);
        s = UnlockAttemptPlan.onSucceeded(s);
        s = fail(s, 9_000);
        assertFalse("the run restarted, this is failure one", s.report);
        assertEquals(1, s.attempts);
    }

    @Test
    public void failuresSpreadOverAWeek_areNotAnIntruder() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        long day = 24L * 3600_000L;
        s = fail(s, 0);
        s = fail(s, 2 * day);
        s = fail(s, 4 * day);
        assertFalse(s.report);
    }

    @Test
    public void failuresJustInsideTheWindow_count_justOutsideStartOver() {
        UnlockAttemptPlan.State a = UnlockAttemptPlan.initial();
        a = fail(a, 0);
        a = fail(a, 60_000);
        a = fail(a, UnlockAttemptPlan.WINDOW_MS);
        assertTrue("third one exactly at the window edge still counts", a.report);

        UnlockAttemptPlan.State b = UnlockAttemptPlan.initial();
        b = fail(b, 0);
        b = fail(b, 60_000);
        b = fail(b, UnlockAttemptPlan.WINDOW_MS + 1);
        assertFalse("one millisecond later it is a new run", b.report);
    }

    @Test
    public void keepGuessing_doesNotFloodTheFamily() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        int reports = 0;
        for (int i = 0; i < 12; i++) {
            s = fail(s, 1_000L + i * 5_000L);
            if (s.report) reports++;
        }
        assertEquals("one report, then quiet for the cooldown", 1, reports);
    }

    @Test
    public void afterTheCooldown_aNewRunIsReportedAgain() {
        UnlockAttemptPlan.State s = UnlockAttemptPlan.initial();
        s = fail(s, 0); s = fail(s, 1_000); s = fail(s, 2_000);
        assertTrue(s.report);

        long later = 2_000 + UnlockAttemptPlan.COOLDOWN_MS + 1;
        s = fail(s, later); s = fail(s, later + 1_000); s = fail(s, later + 2_000);
        assertTrue(s.report);
    }
}
