package com.scoopfamily.familyguard;

/**
 * Decides whether accelerometer samples amount to a deliberate SOS shake.
 *
 * The gesture is a hard back-and-forth shake held for more than a second —
 * STROKES_TO_ARM changes of direction, each strong, each arriving soon after
 * the last. That is easy to do on purpose and hard to do by accident, which is
 * the whole design problem: this runs while the phone is in a pocket, on a bike
 * at 100 km/h, in a bag being thrown on a seat.
 *
 * How each false trigger is kept out
 * ----------------------------------
 *  · Gravity: removed with a slow low-pass (GRAVITY_TAU_MS), so orientation and
 *    tilting count for nothing.
 *  · Engine and road vibration (15–60 Hz): a second, fast low-pass
 *    (SMOOTH_TAU_MS) passes a hand's 3–6 Hz and flattens vibration well below
 *    the stroke threshold. Without it every vibration cycle reverses direction
 *    and would count as a stroke.
 *  · Potholes, a drop, a slammed door: one or two spikes, never ten strokes.
 *  · Running and walking: the impacts all push the same way, and a stroke only
 *    counts when it points AGAINST the previous one.
 *  · Waving the phone slowly, or an arm swinging: too few strokes inside
 *    WINDOW_MS, and gaps longer than MAX_STROKE_GAP_MS start the count over.
 *  · The phone sleeping between samples: a gap in the samples starts over too,
 *    so two halves of a shake minutes apart are not stitched together.
 *
 * Pure Java: no Android types, no clock. Time arrives with each sample, so
 * ShakePatternTest can replay whole journeys on a plain JVM.
 */
final class ShakePattern {

    static final float G = 9.80665f;

    /** Gravity estimate follows orientation changes slower than this. */
    static final long  GRAVITY_TAU_MS    = 300;
    /**
     * Smoothing that removes vibration but keeps a hand's shake, applied twice.
     * One stage left 16 Hz bike vibration at half strength, enough to pass for
     * strokes; two leave a 6 Hz shake at about two thirds and 16 Hz at a fifth.
     */
    static final long  SMOOTH_TAU_MS     = 15;
    /**
     * A stroke is smoothed linear acceleration at least this strong, in g.
     *
     * Set from real recordings on the Redmi, not simulation: a firm shake
     * measures 1.25–1.5 g at 5–6 strokes a second, and the original 1.6 g
     * needed a shake hard enough to hurt.
     *
     * It cannot go much lower. A gentler shake and a motorbike at speed put the
     * same force through the phone: at 0.8 g the bike and handlebar tests in
     * ShakePatternTest arm, which is a false SOS to a whole family. A "gentle
     * but longer" second path was tried for exactly that reason and failed the
     * same way — see the test named for it. Comfort is bought with DURATION
     * instead (STROKES_TO_ARM), which vibration cannot imitate.
     */
    static final float STROKE_G          = 1.15f;
    /**
     * How squarely a stroke must point back against the previous one (cosine of
     * the angle between them). A hand shaking along a line reverses almost
     * exactly; vibration on three axes points somewhere new each time.
     */
    static final float REVERSAL_COS      = -0.4f;
    /**
     * Every stroke must also lie close to the line of the first one, either way
     * along it (|cosine| at least this). A shake stays on one line for its whole
     * length; vibration wanders across all three axes from one peak to the next.
     */
    static final float SAME_LINE_COS     = 0.5f;   // 0.75 rejected a real shake with a twisting wrist
    /** The next stroke must reverse direction no sooner than this… */
    static final long  MIN_STROKE_GAP_MS = 60;
    /** …and no later than this, or the count starts over. */
    static final long  MAX_STROKE_GAP_MS = 450;
    /**
     * Strokes needed, all inside WINDOW_MS. Eight is roughly 0.8 s at the 5–6
     * strokes a second a real shake produces — half the length the first
     * version demanded, which is what makes it comfortable rather than lowering
     * the force (see STROKE_G).
     */
    static final int   STROKES_TO_ARM    = 10;
    static final long  WINDOW_MS         = 2500;
    /** Samples further apart than this mean the phone slept: start over. */
    static final long  MAX_SAMPLE_GAP_MS = 250;

    private boolean primed = false;
    private long  lastSampleMs;
    private float gx, gy, gz;   // gravity estimate
    private float px, py, pz;   // linear acceleration, first smoothing stage
    private float sx, sy, sz;   // linear acceleration, second smoothing stage

    private int   strokes = 0;
    private long  firstStrokeMs, lastStrokeMs;
    private float vx, vy, vz;   // direction of the last stroke
    private float ax, ay, az;   // unit line of the first stroke

    /** Feeds one sample in m/s² (as SensorEvent delivers it). Returns true when the shake is complete. */
    boolean sample(long timeMs, float x, float y, float z) {
        if (!primed || timeMs - lastSampleMs > MAX_SAMPLE_GAP_MS || timeMs <= lastSampleMs) {
            gx = x; gy = y; gz = z;
            px = py = pz = 0f;
            sx = sy = sz = 0f;
            primed = true;
            lastSampleMs = timeMs;
            strokes = 0;
            return false;
        }

        long dt = timeMs - lastSampleMs;
        lastSampleMs = timeMs;

        float ag = dt / (float) (GRAVITY_TAU_MS + dt);
        gx += ag * (x - gx); gy += ag * (y - gy); gz += ag * (z - gz);

        float as = dt / (float) (SMOOTH_TAU_MS + dt);
        px += as * ((x - gx) - px); py += as * ((y - gy) - py); pz += as * ((z - gz) - pz);
        sx += as * (px - sx);       sy += as * (py - sy);       sz += as * (pz - sz);

        if (strokes > 0 && timeMs - lastStrokeMs > MAX_STROKE_GAP_MS) {
            strokes = 0;
        }

        float magG = (float) Math.sqrt(sx * sx + sy * sy + sz * sz) / G;
        if (magG < STROKE_G) return false;

        if (strokes == 0) {
            begin(timeMs);
            return false;
        }

        float sLen = (float) Math.sqrt(sx * sx + sy * sy + sz * sz);
        float dot = sx * vx + sy * vy + sz * vz;
        float cos = dot / (sLen * (float) Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-6f);
        float onLine = Math.abs((sx * ax + sy * ay + sz * az) / (sLen + 1e-6f));
        if (cos <= REVERSAL_COS && onLine >= SAME_LINE_COS
                && timeMs - lastStrokeMs >= MIN_STROKE_GAP_MS) {
            strokes++;
            lastStrokeMs = timeMs;
            vx = sx; vy = sy; vz = sz;

            if (timeMs - firstStrokeMs > WINDOW_MS) {
                // Too slow overall: this stroke opens a fresh count.
                begin(timeMs);
                return false;
            }
            if (strokes >= STROKES_TO_ARM) {
                strokes = 0;
                return true;
            }
        } else if (dot > 0) {
            // Still the same push, not a new stroke: keep it alive.
            lastStrokeMs = timeMs;
        }
        return false;
    }

    /** Strokes counted so far, for the log. */
    int strokes() { return strokes; }

    /** Strength of the latest sample after gravity removal and smoothing, in g. */
    float lastMagG() {
        return (float) Math.sqrt(sx * sx + sy * sy + sz * sz) / G;
    }

    void reset() {
        primed = false;
        strokes = 0;
    }

    private void begin(long timeMs) {
        strokes = 1;
        firstStrokeMs = timeMs;
        lastStrokeMs = timeMs;
        vx = sx; vy = sy; vz = sz;
        float len = (float) Math.sqrt(sx * sx + sy * sy + sz * sz) + 1e-6f;
        ax = sx / len; ay = sy / len; az = sz / len;
    }
}
