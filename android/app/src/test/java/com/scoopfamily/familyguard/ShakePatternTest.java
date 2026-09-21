package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.junit.Test;

/**
 * Replays synthetic motion through ShakePattern at 100 Hz, the rate
 * ShakeSosDetector asks for. Not 50 Hz: at 50 samples a second a 40 Hz
 * handlebar buzz aliases to a 10 Hz back-and-forth that no filter can tell
 * from a hand shaking — measured here, before the rate was raised.
 *
 * The false-trigger cases matter more than the true ones: a shake that does
 * not fire can be repeated, an SOS sent from a pocket wakes a whole family.
 * The bike cases come from a real report — a member riding at up to 100 km/h.
 */
public class ShakePatternTest {

    private static final float G = ShakePattern.G;
    private static final long STEP_MS = 10;

    /** Motion as acceleration in g on each axis at time t (seconds), excluding gravity. */
    interface Motion { float[] at(double t); }

    /** Runs {@code seconds} of motion with gravity on z; returns the time it armed, or -1. */
    private static long run(ShakePattern p, long startMs, double seconds, Motion m) {
        long end = startMs + (long) (seconds * 1000);
        for (long t = startMs; t <= end; t += STEP_MS) {
            float[] a = m.at((t - startMs) / 1000.0);
            if (p.sample(t, a[0] * G, a[1] * G, a[2] * G + G)) return t;
        }
        return -1;
    }

    private static Motion sine(double hz, float g, int axis) {
        return t -> {
            float[] a = new float[3];
            a[axis] = (float) (g * Math.sin(2 * Math.PI * hz * t));
            return a;
        };
    }

    private static final Motion STILL = t -> new float[3];

    // ── Deliberate shakes arm ────────────────────────────────────────────────

    @Test public void hardShake_4Hz_arms() {
        assertTrue(run(new ShakePattern(), 0, 3, sine(4, 3.0f, 0)) > 0);
    }

    @Test public void fastShake_6Hz_arms() {
        assertTrue(run(new ShakePattern(), 0, 3, sine(6, 2.8f, 1)) > 0);
    }

    /** Not everyone shakes hard: a firm 3 Hz shake at 2.5 g must still count. */
    @Test public void firmShake_3Hz_arms() {
        assertTrue(run(new ShakePattern(), 0, 4, sine(3, 2.5f, 0)) > 0);
    }

    @Test public void shakeAlongGravity_arms() {
        assertTrue(run(new ShakePattern(), 0, 3, sine(4, 3.0f, 2)) > 0);
    }

    @Test public void shake_armsWithinAboutOneAndAHalfSeconds() {
        long armedAt = run(new ShakePattern(), 0, 5, sine(4, 3.0f, 0));
        assertTrue("armed at " + armedAt + "ms", armedAt > 0 && armedAt <= 1800);
    }

    @Test public void shakeAfterSittingStill_arms() {
        ShakePattern p = new ShakePattern();
        assertEquals(-1, run(p, 0, 10, STILL));
        assertTrue(run(p, 10_020, 3, sine(4, 3.0f, 0)) > 0);
    }

    // ── Things that happen by accident do not ────────────────────────────────

    @Test public void shortShake_underASecond_doesNotArm() {
        assertEquals(-1, run(new ShakePattern(), 0, 0.8, sine(4, 3.0f, 0)));
    }

    @Test public void gentleShake_doesNotArm() {
        assertEquals(-1, run(new ShakePattern(), 0, 5, sine(4, 1.2f, 0)));
    }

    /** Below the stroke floor nothing counts, however long it goes on. */
    @Test public void veryWeakMovement_doesNotArm() {
        assertEquals(-1, run(new ShakePattern(), 0, 30, sine(4, 0.6f, 0)));
    }

    /**
     * Why the floor cannot simply be lowered for comfort, kept as a test so the
     * next person does not have to rediscover it: at 0.8 g, a bike at speed
     * produces strokes indistinguishable from a hand's, and the whole family
     * gets a false SOS. Comfort comes from needing FEWER strokes, not weaker ones.
     */
    @Test public void aFloorThisLowWouldLetABikeThrough() {
        assertTrue("0.8g is inside the range bike vibration reaches at the phone",
            ShakePattern.STROKE_G > 0.9f);
    }

    @Test public void slowWave_1Hz_doesNotArm() {
        assertEquals(-1, run(new ShakePattern(), 0, 10, sine(1, 3.0f, 0)));
    }

    @Test public void armSwingWhileRunning_doesNotArm() {
        assertEquals(-1, run(new ShakePattern(), 0, 30, sine(1.5, 2.5f, 1)));
    }

    /** Engine and road vibration on a bike: strong, but 15–40 Hz. */
    @Test public void bikeVibration_doesNotArm() {
        Random r = new Random(7);
        Motion bike = t -> new float[] {
            (float) (3.0 * Math.sin(2 * Math.PI * 23 * t) + 0.6 * r.nextGaussian()),
            (float) (2.0 * Math.sin(2 * Math.PI * 17 * t + 1) + 0.6 * r.nextGaussian()),
            (float) (3.5 * Math.sin(2 * Math.PI * 31 * t + 2) + 0.8 * r.nextGaussian()),
        };
        assertEquals(-1, run(new ShakePattern(), 0, 120, bike));
    }

    @Test public void bikeVibration_acrossManyRides_neverArms() {
        for (int seed = 1; seed <= 20; seed++) {
            Random r = new Random(seed);
            double f1 = 15 + r.nextDouble() * 30, f2 = 15 + r.nextDouble() * 30, f3 = 15 + r.nextDouble() * 30;
            Motion bike = t -> new float[] {
                (float) (3.0 * Math.sin(2 * Math.PI * f1 * t) + 0.7 * r.nextGaussian()),
                (float) (3.0 * Math.sin(2 * Math.PI * f2 * t + 1) + 0.7 * r.nextGaussian()),
                (float) (3.0 * Math.sin(2 * Math.PI * f3 * t + 2) + 0.7 * r.nextGaussian()),
            };
            assertEquals("seed " + seed + " (" + (int) f1 + "/" + (int) f2 + "/" + (int) f3 + " Hz)",
                -1, run(new ShakePattern(), 0, 60, bike));
        }
    }

    /** A handlebar mount shaking mostly along one axis — the case the same-line rule cannot catch. */
    @Test public void singleAxisHandlebarVibration_doesNotArm() {
        for (double hz = 12; hz <= 45; hz += 1.5) {
            final double f = hz;
            assertEquals(hz + " Hz", -1, run(new ShakePattern(), 0, 30, sine(f, 3.0f, 1)));
        }
    }

    /** A rough road: a 5 g jolt with a rebound every 0.6 s. */
    @Test public void potholes_doNotArm() {
        Motion road = t -> {
            double phase = t % 0.6;
            float z = phase < 0.04 ? 5f : phase < 0.10 ? -3f : 0f;
            return new float[] { 0f, 0f, z };
        };
        assertEquals(-1, run(new ShakePattern(), 0, 60, road));
    }

    /** Running with the phone in a pocket: impacts all push the same way. */
    @Test public void runningImpacts_doNotArm() {
        Motion running = t -> {
            double phase = (t * 2.8) % 1.0;
            float z = phase < 0.25 ? (float) (3.0 * Math.sin(Math.PI * phase / 0.25)) : -0.8f;
            return new float[] { 0.3f, 0f, z };
        };
        assertEquals(-1, run(new ShakePattern(), 0, 60, running));
    }

    @Test public void droppedPhone_doesNotArm() {
        Motion drop = t -> {
            if (t < 0.4) return new float[] { 0f, 0f, -1f };          // free fall
            if (t < 0.46) return new float[] { 2f, -3f, 8f };         // impact
            if (t < 0.6) return new float[] { -1f, 1.5f, -3f };       // bounce
            return new float[3];
        };
        assertEquals(-1, run(new ShakePattern(), 0, 3, drop));
    }

    /** The phone sleeping mid-shake must not stitch two short shakes into one. */
    @Test public void twoShortShakesSplitBySleep_doNotArm() {
        ShakePattern p = new ShakePattern();
        assertEquals(-1, run(p, 0, 0.8, sine(4, 3.0f, 0)));
        assertEquals(-1, run(p, 5_000, 0.8, sine(4, 3.0f, 0)));
    }

    // ── Real recordings (Redmi, 2026-09-17) ──────────────────────────────────
    //
    // Raw accelerometer clips (ms, x, y, z in m/s²) from a calibration session.
    // The first version of the thresholds needed a shake hard enough to hurt;
    // these keep a natural firm shake working through any future retuning.

    /** Replays a recorded clip; returns the clip time it armed at, or -1. */
    private static long replay(String name) throws Exception {
        ShakePattern p = new ShakePattern();
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(
                ShakePatternTest.class.getResourceAsStream("/shake/" + name + ".csv")))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] f = line.split(",");
                long t = Long.parseLong(f[0]);
                if (p.sample(t, Float.parseFloat(f[1]), Float.parseFloat(f[2]), Float.parseFloat(f[3]))) return t;
            }
        }
        return -1;
    }

    @Test public void recordedFirmShake_arms() throws Exception {
        assertTrue("a natural firm 6 Hz shake at ~1.5 g must arm", replay("firm-shake-redmi") > 0);
    }

    @Test public void recordedGentleHandling_doesNotArm() throws Exception {
        assertEquals(-1, replay("gentle-handling-redmi"));
    }

    @Test public void arming_startsTheCountOver() {
        ShakePattern p = new ShakePattern();
        long armedAt = run(p, 0, 5, sine(4, 3.0f, 0));
        assertTrue(armedAt > 0);
        assertEquals(0, p.strokes());
    }

    @Test public void resetForgetsAPartialShake() {
        ShakePattern p = new ShakePattern();
        run(p, 0, 0.9, sine(4, 3.0f, 0));
        p.reset();
        assertFalse(p.strokes() > 0);
    }
}
