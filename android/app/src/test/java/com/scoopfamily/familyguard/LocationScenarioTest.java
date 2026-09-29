package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Replays whole sequences of fixes (positions along a line, in metres) through
 * LocationFilter + CoarseFixConfirm the way LocationForegroundService chains them,
 * and checks where the visible pin ends up. The device-side glue (TeleportGuard,
 * timestamps) is covered by its own tests; this is about the outcome a person sees.
 */
public class LocationScenarioTest {

    private static final float NONE = LocationFilter.NO_DISTANCE;

    /** The accepted position, as the service would hold it. */
    private static final class Pin {
        float x = Float.NaN; float acc = NONE; long t = 0L; boolean has = false;
        LocationFilter.Result last;
        final CoarseFixConfirm coarse = new CoarseFixConfirm();
        float candX = Float.NaN; float candAcc = NONE;

        void fix(float x, float acc, float speed, long now) {
            float moved = has ? Math.abs(x - this.x) : NONE;
            long since = has ? now - t : 0L;
            LocationFilter.Result r = LocationFilter.evaluate(acc, has ? this.acc : NONE, has, moved, since,
                false, NONE, 0, 0, speed);
            last = r;
            boolean accept = r.shouldPush();
            if (r.outcome == LocationFilter.Outcome.DISCARDED_ACCURACY && has && acc <= CoarseFixConfirm.MAX_M) {
                boolean confirmed = coarse.offer(acc,
                    Float.isNaN(candX) ? NONE : Math.abs(x - candX), candAcc, now);
                candX = x; candAcc = acc;
                float implied = since > 0 ? moved / (since / 1000f) : Float.MAX_VALUE;
                boolean motionEvidence = CoarseFixConfirm.hasMotionEvidence(
                    speed != LocationFilter.NO_SPEED, speed, false);
                if (confirmed && moved >= acc * LocationFilter.COARSE_FIX_MOVE_FACTOR
                        && implied <= LocationFilter.MAX_PLAUSIBLE_SPEED_MPS && motionEvidence) accept = true;
            } else if (r.outcome != LocationFilter.Outcome.DISCARDED_ACCURACY) {
                coarse.reset(); candX = Float.NaN;
            }
            if (accept) {
                coarse.reset(); candX = Float.NaN;
                if (!(r.outcome == LocationFilter.Outcome.ACCEPTED_HEARTBEAT && r.keepLastPosition)) {
                    this.x = x; this.acc = acc;
                }
                this.has = true; this.t = now;
            }
        }
    }

    @Test
    public void indoorWifiGuesses_neverMoveAStationaryPin() {
        Pin p = new Pin();
        p.fix(0, 20, 0, 0);
        long t = 5_000;
        float[] guesses = {90, -80, 130, -110, 60, 150};
        for (float g : guesses) { p.fix(g, 90, LocationFilter.NO_SPEED, t); t += 10_000; }
        assertEquals(0f, p.x, 0f);
    }

    @Test
    public void single500mPoorFix_isIgnored() {
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        p.fix(500, 300, LocationFilter.NO_SPEED, 10_000);
        assertEquals(0f, p.x, 0f);
    }

    @Test
    public void poorFixThenAccurateFixNearIt_movesThePinToTheAccurateFix() {
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        p.fix(350, 280, LocationFilter.NO_SPEED, 10_000);   // held, not shown
        assertEquals(0f, p.x, 0f);
        p.fix(345, 30, LocationFilter.NO_SPEED, 20_000);    // precise and near the candidate
        assertEquals(345f, p.x, 0f);
    }

    @Test
    public void genuineMoveWithMediocreGps_isEventuallyShown() {
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        long t = 10_000;
        // The member walks 300m away (~1.3 m/s) and GPS stays at ~130m for a minute.
        for (int i = 0; i < 8; i++) { p.fix(300, 130, 1.3f, t); t += 10_000; }
        assertEquals(300f, p.x, 0f);
        assertEquals("the pin carries the fix's own accuracy, not a better one", 130f, p.acc, 0f);
    }

    @Test
    public void genuineMoveWithNoSpeedReadingAtAll_isNeverShown() {
        // Same walk as above, but the fix carries no speed (common for network/
        // Wi-Fi fixes) and nothing else shows real movement: indistinguishable
        // from a stationary phone's stuck fix, so it must not move the pin.
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        long t = 10_000;
        for (int i = 0; i < 8; i++) { p.fix(300, 130, LocationFilter.NO_SPEED, t); t += 10_000; }
        assertEquals(0f, p.x, 0f);
    }

    @Test
    public void moveOver200mAccuracy_needsThreeAgreeingReads() {
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        p.fix(600, 250, 2f, 10_000);
        p.fix(600, 250, 2f, 30_000);
        assertEquals("two reads at 250m is not enough", 0f, p.x, 0f);
        p.fix(600, 250, 2f, 60_000);
        assertEquals(600f, p.x, 0f);
    }

    @Test
    public void stationaryPhoneWithAStuckWifiFix_neverConfirmsEvenWithEnoughReadsAndTime() {
        // The exact "phone lying still overnight" pattern: the same wrong
        // position, repeated well past the read/time thresholds, with no
        // speed reading — because the phone never moved.
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        long t = 10_000;
        for (int i = 0; i < 6; i++) { p.fix(300, 130, LocationFilter.NO_SPEED, t); t += 60_000; }
        assertEquals(0f, p.x, 0f);
    }

    @Test
    public void nothingWorseThan500m_everMovesTheVisiblePin() {
        Pin p = new Pin();
        p.fix(0, 15, 0, 0);
        long t = 10_000;
        for (int i = 0; i < 10; i++) { p.fix(900, 700, LocationFilter.NO_SPEED, t); t += 20_000; }
        assertEquals(0f, p.x, 0f);
    }

    @Test
    public void vehicleTravelling_isFollowedEvenThroughAPoorPatch() {
        Pin p = new Pin();
        p.fix(0, 10, 12, 0);
        p.fix(100, 12, 12, 8_000);
        p.fix(420, 150, 12, 20_000);   // 150m accuracy, but 12 m/s and 320m covered: evidence of travel
        assertEquals(420f, p.x, 0f);
    }

    @Test
    public void pinKeepsItsLastGoodPosition_whenGpsGoesPoorAndReturns() {
        Pin p = new Pin();
        p.fix(0, 10, 0, 0);
        p.fix(40, 400, LocationFilter.NO_SPEED, 30_000);
        p.fix(-60, 450, LocationFilter.NO_SPEED, 60_000);
        assertEquals(0f, p.x, 0f);
        p.fix(3, 8, 0, 90_000);   // good again, same place: nothing to show
        assertTrue(Math.abs(p.x) <= 3f);
    }
}
