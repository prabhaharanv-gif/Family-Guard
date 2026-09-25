package com.scoopfamily.familyguard;

/**
 * The timing rules of "Phone lost" mode, apart from any Android type so they run
 * on a plain JVM (LostModePlanTest).
 *
 * While lost mode is on the phone:
 *  - reports its position at least every PUSH_EVERY_MS, standing still or not;
 *  - rings every RING_EVERY_MS: a burst, then quiet, so the battery lasts and a
 *    person nearby can find it — not a continuous siren;
 *  - stops by itself at the deadline, and never runs longer than MAX_MS even if
 *    the server value is missing or absurd, so a forgotten switch cannot drain
 *    a phone for days.
 */
final class LostModePlan {

    static final long RING_EVERY_MS = 2 * 60_000L;
    static final long PUSH_EVERY_MS = 10_000L;
    static final long MAX_MS        = 12 * 3600_000L;

    private LostModePlan() {}

    /** The deadline to store: the server one, but never more than MAX_MS away. */
    static long deadline(long nowMs, long serverUntilMs) {
        long cap = nowMs + MAX_MS;
        if (serverUntilMs <= nowMs) return cap;          // missing or already past: use the cap
        return Math.min(serverUntilMs, cap);
    }

    static boolean active(long nowMs, long untilMs) {
        return untilMs > 0 && nowMs < untilMs;
    }

    static boolean shouldRing(long nowMs, long untilMs, long lastRingMs) {
        return active(nowMs, untilMs) && nowMs - lastRingMs >= RING_EVERY_MS;
    }

    static boolean shouldForcePush(long nowMs, long untilMs, long lastPushMs) {
        return active(nowMs, untilMs) && nowMs - lastPushMs >= PUSH_EVERY_MS;
    }
}
