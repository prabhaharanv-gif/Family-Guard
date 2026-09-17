package com.scoopfamily.familyguard;

/**
 * Decides whether the location request should run at the moving or the
 * stationary cadence, and says when that answer has changed.
 *
 * Extracted from LocationForegroundService for the same reason as
 * LocationFilter: the rule has edge cases worth pinning (hysteresis at a red
 * light, the very first fix, not re-registering the request on every delivery)
 * and none of them need a handset. Plain Java, no Android types, unit tested in
 * CadencePlanTest. The service keeps the measuring — displacement from
 * Location#distanceTo, speed from the fix — and passes the answers in.
 *
 * Why it starts in the moving state: a service that has just started knows
 * nothing about the phone yet, and settling to the slow cadence on the strength
 * of one reading would mean a member who opened the app mid-journey waited a
 * full slow tick before being tracked properly. Starting fast and relaxing
 * costs one quiet window; starting slow costs a visibly late pin.
 */
final class CadencePlan {

    /** How long without movement before the stationary cadence applies. */
    private final long stillAfterMs;

    private boolean moving = true;
    private long lastMovementMs = 0L;

    CadencePlan(long stillAfterMs) {
        this.stillAfterMs = stillAfterMs;
    }

    /** True while the fast cadence should be registered. */
    boolean isMoving() {
        return moving;
    }

    /**
     * Feeds one fix in.
     *
     * @param movedFar   the fix is at least MIN_MOVE_M from the last pushed one
     * @param movingFast the fix reports at least walking pace
     * @param nowMs      current time in millis
     * @return true if the cadence just changed, meaning the caller must
     *         re-register the location request. False on every other fix, so
     *         the common case costs nothing.
     */
    boolean update(boolean movedFar, boolean movingFast, long nowMs) {
        if (movedFar || movingFast) lastMovementMs = nowMs;

        // First fix ever: treat the start as movement so the opening window
        // stays fast rather than settling on a single reading.
        if (lastMovementMs == 0L) lastMovementMs = nowMs;

        boolean shouldMove = nowMs - lastMovementMs < stillAfterMs;
        if (shouldMove == moving) return false;

        moving = shouldMove;
        return true;
    }
}
