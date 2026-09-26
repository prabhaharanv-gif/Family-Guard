package com.scoopfamily.familyguard;

/**
 * Keeps a stale or one-off far-away position from moving a phone that has not
 * moved (2026-09-26).
 *
 * A member's phone sat still at home while, every few minutes, one fix at the
 * SAME coordinates 260m away reached the server, and 5 seconds later the real
 * fix returned. Each round trip moved the pin and fired "Reached Home / Left
 * Our home / Left Home / Reached Our home". The repeated coordinates are a
 * cached position (fused provider's last known, or a Wi-Fi database entry),
 * and the service delivers it twice in the same instant (LAST_KNOWN plus the
 * first FUSED result), so "two fixes agree" proved nothing.
 *
 * Two rules, both pure so they run on a plain JVM (TeleportGuardTest):
 *
 *   1. isStale: a fix stamped more than STALE_FIX_MS ago is a memory, not a
 *      reading. Never used to judge a place or move a pin.
 *   2. shouldHold: a fix this far from the last pushed position, with no
 *      recent evidence of movement, is held until it has PERSISTED for
 *      CONFIRM_MS. A real move persists; the glitch is gone in seconds. After
 *      a long silence (phone was off, no data) there is nothing to compare
 *      against, so nothing is held.
 */
final class TeleportGuard {

    /** A fix older than this is not a live reading. */
    static final long STALE_FIX_MS = 30_000L;

    /** Farther than this from the last push counts as a jump that needs backing. */
    static final float TELEPORT_M = 100f;
    /** A held fix is continued by a later one landing within this of it... */
    static final float CANDIDATE_RADIUS_M = 50f;
    /**
     * ...plus this much per second since the last held fix, so a vehicle moving
     * along a road keeps counting as ONE persisting move. Without it every fix
     * of a real drive (poor GPS, no speed reading) restarted the wait and the
     * pin froze for up to BASELINE_TOO_OLD_MS.
     */
    static final float CONTINUE_MPS = 40f;
    /** How long the new position must hold before it is believed. */
    static final long CONFIRM_MS = 20_000L;
    /** Movement seen this recently (a GPS-quality fix with speed) vouches for a jump. */
    static final long MOTION_WINDOW_MS = 3 * 60_000L;
    /** Past this silence the old position is too old to argue with. */
    static final long BASELINE_TOO_OLD_MS = 10 * 60_000L;

    static final float NO_DISTANCE = -1f;

    private boolean hasCandidate = false;
    private long candidateSinceMs = 0L;
    private long lastHeldMs = 0L;

    static boolean isStale(long fixAgeMs) {
        return fixAgeMs > STALE_FIX_MS;
    }

    /**
     * True when this fix must be ignored for now.
     *
     * @param movedM          distance from the last pushed position (ignored without a baseline)
     * @param msSinceLastPush time since that push
     * @param recentMotion    a moving GPS-quality fix was seen within MOTION_WINDOW_MS
     * @param fromCandidateM  distance from the fix already being held, or NO_DISTANCE
     * @param nowMs           any monotonic clock, as long as it is the same one every call
     */
    boolean shouldHold(boolean hasBaseline, float movedM, long msSinceLastPush,
                       boolean recentMotion, float fromCandidateM, long nowMs) {
        if (!hasBaseline || movedM < TELEPORT_M || recentMotion || msSinceLastPush > BASELINE_TOO_OLD_MS) {
            hasCandidate = false;
            return false;
        }
        boolean continues = hasCandidate && fromCandidateM != NO_DISTANCE
            && fromCandidateM <= CANDIDATE_RADIUS_M + CONTINUE_MPS * ((nowMs - lastHeldMs) / 1000f);
        if (!continues) {
            hasCandidate = true;
            candidateSinceMs = nowMs;
            lastHeldMs = nowMs;
            return true;
        }
        lastHeldMs = nowMs;
        return nowMs - candidateSinceMs < CONFIRM_MS;
    }

    /** True while a fix is being held, so the caller knows to measure fromCandidateM. */
    boolean hasCandidate() {
        return hasCandidate;
    }
}
