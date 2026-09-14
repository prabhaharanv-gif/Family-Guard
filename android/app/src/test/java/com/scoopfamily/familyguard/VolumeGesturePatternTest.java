package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

/**
 * Covers the SOS volume gesture: two presses one way, then two the other.
 *
 * Every case here was previously checked by pressing buttons on one phone and
 * reading logcat. The timings used are the ones actually measured on that
 * device, so these are not invented numbers — a real burst landed its presses
 * roughly 300-700ms apart, and that is what the happy-path tests use.
 */
public class VolumeGesturePatternTest {

    private static final int UP   = 1;
    private static final int DOWN = -1;

    /** Comfortably above MIN_GAP_MS and below the window; matches a real burst. */
    private static final long GAP = 400;

    private VolumeGesturePattern pattern;
    private long now;

    @Before
    public void setUp() {
        pattern = new VolumeGesturePattern();
        // Start well clear of zero so "no previous press" is distinguishable
        // from "a press long ago".
        now = 1_000_000L;
    }

    /** Advances the clock and feeds one press in. */
    private VolumeGesturePattern.Result press(int direction, long afterMs) {
        now += afterMs;
        return pattern.press(direction, now);
    }

    // ── The gesture itself ───────────────────────────────────────────────────

    @Test
    public void upUpDownDown_arms() {
        press(UP,   0);
        press(UP,   GAP);
        press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertTrue("four correctly shaped presses should arm", r.isArmed());
        assertEquals("volume-up2-down2", r.source);
    }

    @Test
    public void downDownUpUp_arms() {
        press(DOWN, 0);
        press(DOWN, GAP);
        press(UP,   GAP);
        VolumeGesturePattern.Result r = press(UP, GAP);

        assertTrue("the reverse order is equally valid", r.isArmed());
        assertEquals("volume-down2-up2", r.source);
    }

    /**
     * Both orders are accepted because detection can go blind at either end of
     * the volume scale — at maximum an Up changes nothing, at zero a Down does.
     * Whichever way the user starts, one direction is always observable.
     */
    @Test
    public void bothOrders_reportTheirOwnLabel() {
        press(UP, 0); press(UP, GAP); press(DOWN, GAP);
        assertEquals("volume-up2-down2", press(DOWN, GAP).source);

        pattern = new VolumeGesturePattern();
        press(DOWN, 5000); press(DOWN, GAP); press(UP, GAP);
        assertEquals("volume-down2-up2", press(UP, GAP).source);
    }

    /**
     * Regression: resetRun() zeroed firstDirection before the label was derived
     * from it, so every gesture reported itself as down-first regardless of how
     * it was actually performed. Found by reading a log after the fact; this is
     * the test that would have caught it.
     */
    @Test
    public void upFirstGesture_isNotLabelledDownFirst() {
        press(UP, 0); press(UP, GAP); press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertEquals("an up-first gesture must not be reported as down-first",
            "volume-up2-down2", r.source);
    }

    // ── Timing ───────────────────────────────────────────────────────────────

    @Test
    public void pressesTooCloseTogether_countOnce() {
        press(UP, 0);
        VolumeGesturePattern.Result r = press(UP, VolumeGesturePattern.MIN_GAP_MS - 1);

        assertEquals("a doubled event is one press, not two",
            VolumeGesturePattern.Outcome.IGNORED_DEBOUNCE, r.outcome);
    }

    /**
     * One physical press can surface twice — once as the key event and once as
     * the volume change it causes. Debouncing must not swallow the real second
     * press that follows, or the gesture becomes unreachable.
     */
    @Test
    public void debouncedDuplicate_doesNotConsumeTheRealNextPress() {
        press(UP, 0);
        press(UP, VolumeGesturePattern.MIN_GAP_MS - 1);   // echo of the first
        press(UP, GAP);                                    // the genuine second
        press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertTrue("an echoed press must not cost the gesture", r.isArmed());
    }

    @Test
    public void tooSlowBetweenPresses_startsANewRun() {
        press(UP, 0);
        press(UP, GAP);
        VolumeGesturePattern.Result r = press(DOWN, VolumeGesturePattern.WINDOW_MS + 1);

        assertEquals("a press beyond the window begins again rather than continuing",
            VolumeGesturePattern.Outcome.STARTED, r.outcome);
    }

    /**
     * The failure seen repeatedly on the device: isolated presses seconds apart,
     * each one starting over, never assembling into a gesture.
     */
    @Test
    public void isolatedPressesSecondsApart_neverArm() {
        for (int i = 0; i < 8; i++) {
            VolumeGesturePattern.Result r = press(i % 2 == 0 ? UP : DOWN, 16_000);
            assertFalse("presses this far apart must never arm", r.isArmed());
        }
    }

    // ── Accident resistance ──────────────────────────────────────────────────

    @Test
    public void threeInTheSameDirection_abandonsTheRun() {
        press(UP, 0);
        press(UP, GAP);
        VolumeGesturePattern.Result r = press(UP, GAP);

        assertEquals("a third press one way is volume adjustment, not the gesture",
            VolumeGesturePattern.Outcome.RESET, r.outcome);
    }

    /**
     * The reason QUIET_BEFORE_MS exists. A long run of same-direction presses
     * resets partway through, and without a required pause the tail of that run
     * becomes the head of a new pattern — so two presses the other way would
     * fire an alert nobody asked for.
     */
    @Test
    public void longVolumeRampThenReversal_doesNotArm() {
        press(UP, 0);
        press(UP, GAP);
        press(UP, GAP);   // resets here
        press(UP, GAP);   // too soon after to begin a new pattern
        press(UP, GAP);
        press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertFalse("ramping the volume up then down must not raise an SOS", r.isArmed());
    }

    @Test
    public void afterAQuietPause_aNewPatternMayBegin() {
        press(UP, 0);
        press(UP, GAP);
        press(UP, GAP);   // reset — too many

        press(DOWN, VolumeGesturePattern.QUIET_BEFORE_MS + 1);
        press(DOWN, GAP);
        press(UP,   GAP);
        VolumeGesturePattern.Result r = press(UP, GAP);

        assertTrue("a deliberate gesture after a pause must still work", r.isArmed());
    }

    /**
     * One press then two the other way DOES arm, and that is deliberate.
     *
     * Measured on the Redmi with the screen off, the volume routing path drops
     * the first press of every gesture and sometimes a second: three attempts
     * at up-up-down-down arrived as 3, 2 and 3 presses. Insisting on two before
     * the reversal made the gesture impossible to perform in exactly the
     * situation it exists for. The user still presses two and two; this is what
     * lets the run survive losing one of them.
     *
     * The accident guards that remain are the direction reversal itself, the
     * quiet period before a pattern may start, and the 3-second cancel window.
     */
    @Test
    public void aSinglePressBeforeTheReversal_stillArms() {
        press(UP,   0);
        press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertTrue("the gesture must survive a dropped leading press", r.isArmed());
        assertEquals("volume-up2-down2", r.source);
    }

    @Test
    public void aLoneReversalIsNotEnough() {
        press(UP,   0);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertFalse("one press each way is not the gesture", r.isArmed());
    }

    @Test
    public void flippingBackDuringTheSecondRun_doesNotArm() {
        press(UP,   0);
        press(UP,   GAP);
        press(DOWN, GAP);
        press(UP,   GAP);   // flipped back
        VolumeGesturePattern.Result r = press(UP, GAP);

        assertFalse("a wobble in the second run must not complete the gesture", r.isArmed());
    }

    @Test
    public void fivePressesInOneDirection_neverArm() {
        for (int i = 0; i < 5; i++) {
            assertFalse(press(DOWN, GAP).isArmed());
        }
    }

    // ── State handling ───────────────────────────────────────────────────────

    @Test
    public void reset_discardsTheRunInProgress() {
        press(UP, 0);
        press(UP, GAP);
        pattern.reset();

        press(DOWN, GAP);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertFalse("a run abandoned mid-way must not resume", r.isArmed());
    }

    @Test
    public void armingClearsState_soTheNextGestureStartsClean() {
        press(UP, 0); press(UP, GAP); press(DOWN, GAP);
        assertTrue(press(DOWN, GAP).isArmed());

        // Two more downs would complete the previous run if state had survived.
        press(DOWN, VolumeGesturePattern.QUIET_BEFORE_MS + 1);
        VolumeGesturePattern.Result r = press(DOWN, GAP);

        assertFalse("state must not leak from one gesture into the next", r.isArmed());
    }

    @Test
    public void twoGesturesInARow_bothArm() {
        press(UP, 0); press(UP, GAP); press(DOWN, GAP);
        assertTrue(press(DOWN, GAP).isArmed());

        press(UP, 5000); press(UP, GAP); press(DOWN, GAP);
        assertTrue("the detector must be reusable", press(DOWN, GAP).isArmed());
    }

    @Test
    public void nonArmingResults_carryNoSource() {
        assertNull(press(UP, 0).source);
        assertNull(press(UP, GAP).source);
        assertNull(press(UP, GAP).source);
    }

    @Test
    public void everyResultExplainsItself() {
        VolumeGesturePattern.Result[] results = {
            press(UP, 0),
            press(UP, VolumeGesturePattern.MIN_GAP_MS - 1),
            press(UP, GAP),
            press(UP, GAP),
        };
        for (VolumeGesturePattern.Result r : results) {
            assertTrue("a result with no detail is useless in a log",
                r.detail != null && !r.detail.isEmpty());
        }
    }
}
