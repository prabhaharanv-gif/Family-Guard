package com.scoopfamily.familyguard;

/**
 * Decides what happens to a location fix: push it, hold it, or throw it away.
 *
 * This is the logic that decides whether a family member appears on the map and
 * how current their pin is. Getting it wrong is not cosmetic — too strict and
 * somebody looks like they stopped sharing, too loose and their pin teleports
 * across town and back.
 *
 * Distances are supplied by the caller, never computed here
 * ---------------------------------------------------------
 * Every distance arrives as a parameter in metres, measured by the caller with
 * android.location.Location#distanceTo. That is deliberate. Recomputing it here
 * with haversine would be tidier to test but would quietly change every
 * comparison in the app, because distanceTo uses the WGS84 ellipsoid and
 * haversine assumes a sphere. The rules are what needed testing; the geometry
 * was already correct and is left exactly where it was.
 *
 * What remains is pure: no Android types, no clock, no I/O. Time arrives as a
 * parameter and the answer comes back as a value, so it runs on a plain JVM.
 */
final class LocationFilter {

    /** Discard fixes worse than this once we have a baseline. */
    static final float MAX_ACCURACY_M = 100f;
    /**
     * Until this device has pushed anything there is no row in `locations` at
     * all, and the Family list draws the member as if they were not sharing.
     * Indoors the first fix is routinely worse than 100m, so the strict gate
     * could keep somebody who had just joined invisible for as long as they
     * stayed inside. A rough first position beats none.
     */
    static final float FIRST_FIX_ACCURACY_M = 2000f;
    /** Only push if moved this far from the last push. */
    static final float MIN_MOVE_M = 15f;

    /** Anything implying faster than this is held for confirmation. ~200 km/h. */
    static final float MAX_PLAUSIBLE_SPEED_MPS = 55f;
    /** A held fix is confirmed if the next one lands within this of it. */
    static final float JUMP_CONFIRM_RADIUS_M = 50f;
    /**
     * Ceiling on the elapsed time used for the speed check.
     *
     * Without it a stale baseline makes a big jump look slow — 5km across a 90s
     * stationary heartbeat is only ~200km/h — even though the person never
     * moved. Real movement pushes far more often than once per heartbeat, so
     * clamping does not affect genuine fast travel, only stale baselines.
     */
    static final long SPEED_CLAMP_MS = 20_000L;

    /** Push at least this often even when stationary, so the pin stays "live". */
    static final long HEARTBEAT_MS = 90_000L;

    /** No distance available — used when there is no baseline or nothing pending. */
    static final float NO_DISTANCE = -1f;

    enum Outcome {
        /** Push it. */
        ACCEPTED,
        /** Push it, though the member has not moved — keeps the pin from going stale. */
        ACCEPTED_HEARTBEAT,
        /** Too imprecise to be worth anything. */
        DISCARDED_ACCURACY,
        /** Implies an impossible speed; held until a second fix agrees. */
        REJECTED_JUMP,
        /** Hasn't moved far enough, and the heartbeat isn't due. */
        SKIPPED_TOO_CLOSE
    }

    /** The verdict on one fix, plus what the caller must remember. */
    static final class Result {
        final Outcome outcome;
        /** Message for the log, written to follow the source token. */
        final String  detail;
        /** An extra line to log before the outcome — currently only jump confirmation. */
        final String  note;
        /** Store this fix as the pending jump candidate. */
        final boolean holdAsPendingJump;
        /** Forget any pending jump candidate. */
        final boolean clearPendingJump;

        private Result(Outcome outcome, String detail, String note,
                       boolean holdAsPendingJump, boolean clearPendingJump) {
            this.outcome           = outcome;
            this.detail            = detail;
            this.note              = note;
            this.holdAsPendingJump = holdAsPendingJump;
            this.clearPendingJump  = clearPendingJump;
        }

        /** True when the caller should push this fix. */
        boolean shouldPush() {
            return outcome == Outcome.ACCEPTED || outcome == Outcome.ACCEPTED_HEARTBEAT;
        }
    }

    private LocationFilter() {}

    /**
     * Applies the three gates in order: accuracy, then jump, then distance.
     *
     * @param accuracyM      reported accuracy of this fix, in metres.
     * @param hasLastPush    false before anything has ever been pushed.
     * @param movedM         distance from the last pushed position, or NO_DISTANCE.
     * @param msSinceLastPush time since the last push; meaningless without a baseline.
     * @param hasPendingJump whether a fix is already being held for confirmation.
     * @param fromPendingM   distance from that held fix, or NO_DISTANCE.
     */
    static Result evaluate(float accuracyM,
                           boolean hasLastPush,
                           float movedM,
                           long msSinceLastPush,
                           boolean hasPendingJump,
                           float fromPendingM) {

        // Accuracy gate — discard poor fixes, but let the very first one through
        // so the member stops looking like they are not sharing.
        float accuracyLimit = hasLastPush ? MAX_ACCURACY_M : FIRST_FIX_ACCURACY_M;
        if (accuracyM > accuracyLimit) {
            return new Result(Outcome.DISCARDED_ACCURACY,
                "fix discarded — accuracy " + accuracyM + "m > " + accuracyLimit + "m",
                null, false, false);
        }

        if (!hasLastPush) {
            return new Result(Outcome.ACCEPTED,
                "fix accepted — accuracy=" + accuracyM + "m | moved=first fix",
                null, false, false);
        }

        // Jump gate — reject a fix implying unrealistic speed unless a second
        // fix roughly confirms it. Catches "pin teleports then snaps back"
        // without ever pushing the bad fix.
        String note = null;
        long  speedElapsedMs = Math.min(msSinceLastPush, SPEED_CLAMP_MS);
        float impliedMps = speedElapsedMs > 0 ? movedM / (speedElapsedMs / 1000f) : 0f;

        boolean clearPending = false;
        if (impliedMps > MAX_PLAUSIBLE_SPEED_MPS) {
            if (hasPendingJump && fromPendingM <= JUMP_CONFIRM_RADIUS_M) {
                note = "jump confirmed by second fix (" + movedM + "m, "
                     + (impliedMps * 3.6f) + " km/h implied) — accepting";
                clearPending = true;
            } else {
                return new Result(Outcome.REJECTED_JUMP,
                    "fix rejected as GPS jump — " + movedM + "m in " + msSinceLastPush
                        + "ms (" + (impliedMps * 3.6f) + " km/h implied) — awaiting confirmation",
                    null, true, false);
            }
        } else {
            clearPending = true;
        }

        // Distance gate — only push if moved far enough, or if the heartbeat is
        // due so a stationary member's pin stays live instead of going stale.
        if (movedM < MIN_MOVE_M && msSinceLastPush < HEARTBEAT_MS) {
            return new Result(Outcome.SKIPPED_TOO_CLOSE,
                "fix skipped — moved " + movedM + "m, heartbeat in "
                    + ((HEARTBEAT_MS - msSinceLastPush) / 1000) + "s",
                note, false, clearPending);
        }

        Outcome outcome = movedM < MIN_MOVE_M ? Outcome.ACCEPTED_HEARTBEAT : Outcome.ACCEPTED;
        return new Result(outcome,
            "fix accepted — accuracy=" + accuracyM + "m | moved=" + movedM + "m",
            note, false, clearPending);
    }
}
