package com.scoopfamily.familyguard;

/**
 * Recognises a probable vehicle crash from two things the phone already has:
 * a violent jolt on the accelerometer, and GPS speed collapsing right after it.
 *
 * Neither alone is enough, and that is the design:
 *
 *  - A jolt alone is a pothole, a dropped phone, a slammed door. Phones spike
 *    3 to 5 g on bad roads and far more when dropped.
 *  - A speed drop alone is ordinary braking.
 *  - A jolt while travelling fast, followed within seconds by being (nearly)
 *    stopped, is what a crash looks like. A phone dropped inside a car that
 *    keeps driving fails the second half; a hard stop at a signal fails the
 *    first.
 *
 * It is still a guess, which is why a recognised crash only STARTS a countdown
 * with a loud Cancel (SosArming) and never sends by itself.
 *
 * Pure: no Android types, no clock. Times are milliseconds on ONE clock — the
 * caller feeds accelerometer time and GPS time both as elapsed-realtime — and
 * the answer is a value, so it runs on a plain JVM (CrashPatternTest).
 */
final class CrashPattern {

    /** Accelerometer magnitude, in g, that counts as an impact (gravity included). */
    static final float  IMPACT_G = 5f;
    /** Speed before the impact for it to count as "driving". */
    static final float  DRIVING_KMH = 30f;
    /** At or below this after the impact, the vehicle has effectively stopped. */
    static final float  STOPPED_KMH = 10f;
    /** How old the last speed may be and still describe the moment of impact. */
    static final long   SPEED_FRESH_MS = 15_000L;
    /** How long after an impact a slow-down still confirms it. */
    static final long   CONFIRM_WINDOW_MS = 12_000L;
    /** After a crash is reported, stay quiet so one event raises one countdown. */
    static final long   COOLDOWN_MS = 10 * 60_000L;

    private static final float G = 9.80665f;

    private long  speedAtMs = Long.MIN_VALUE;
    private float speedKmh  = 0f;

    private long  impactAtMs = Long.MIN_VALUE;   // pending impact, else MIN_VALUE
    private float impactG    = 0f;

    private long  lastCrashAtMs = Long.MIN_VALUE;

    /** True while the vehicle is moving fast enough that the sensor is worth running. */
    synchronized boolean drivingAt(long tMs) {
        return speedAtMs != Long.MIN_VALUE
            && tMs - speedAtMs <= SPEED_FRESH_MS
            && speedKmh >= DRIVING_KMH;
    }

    /** The size of the biggest recent impact, for tuning logs; 0 when none pending. */
    synchronized float pendingImpactG() {
        return impactAtMs == Long.MIN_VALUE ? 0f : impactG;
    }

    /** Feed one accelerometer sample (m/s^2). Records an impact; never reports a crash itself. */
    synchronized void onAccel(long tMs, float ax, float ay, float az) {
        double mag = Math.sqrt((double) ax * ax + (double) ay * ay + (double) az * az) / G;
        if (mag < IMPACT_G) return;
        if (impactAtMs != Long.MIN_VALUE) {
            if (mag > impactG) impactG = (float) mag;   // same event, keep the peak
            return;
        }
        if (inCooldown(tMs)) return;
        // Only an impact while driving counts, judged by the speed just before it.
        if (speedAtMs == Long.MIN_VALUE || tMs - speedAtMs > SPEED_FRESH_MS || speedKmh < DRIVING_KMH) return;
        impactAtMs = tMs;
        impactG = (float) mag;
    }

    /**
     * Feed one GPS speed. Returns true exactly once per crash, when a slow-down
     * to a stop follows a recorded impact.
     */
    synchronized boolean onSpeed(long tMs, float kmh) {
        boolean confirmed = false;
        if (impactAtMs != Long.MIN_VALUE) {
            if (tMs - impactAtMs > CONFIRM_WINDOW_MS) {
                impactAtMs = Long.MIN_VALUE;                  // nothing followed: a jolt, not a crash
            } else if (tMs >= impactAtMs && kmh <= STOPPED_KMH) {
                confirmed = true;
                lastCrashAtMs = tMs;
                impactAtMs = Long.MIN_VALUE;
            }
        }
        // A speed taken BEFORE the impact must not be overwritten by one from
        // after it when working out what "driving" was; only advance the memory.
        if (tMs >= speedAtMs) {
            speedAtMs = tMs;
            speedKmh = kmh;
        }
        return confirmed;
    }

    private boolean inCooldown(long tMs) {
        return lastCrashAtMs != Long.MIN_VALUE && tMs - lastCrashAtMs < COOLDOWN_MS;
    }

    synchronized void reset() {
        speedAtMs = Long.MIN_VALUE;
        speedKmh = 0f;
        impactAtMs = Long.MIN_VALUE;
        impactG = 0f;
        lastCrashAtMs = Long.MIN_VALUE;
    }
}
