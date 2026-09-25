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
    /**
     * A fix at least this many times more precise than the last push may
     * correct the pin even without "moving" — how a rough first fix (a 165m
     * Wi-Fi guess after a restart) gets replaced by the 20m GPS fix after it.
     */
    static final float UPGRADE_FACTOR = 2f;

    /**
     * A fix less precise than this is a Wi-Fi/cell guess, not GPS. Its stated
     * accuracy understates its real error, so it must land clear of TWICE that
     * accuracy before it counts as movement (a 60m guess needs 120m). Real
     * walking covers that within one heartbeat; a phone sitting indoors does not.
     */
    static final float COARSE_FIX_ACCURACY_M = 30f;
    static final float COARSE_FIX_MOVE_FACTOR = 2f;

    /** Anything implying faster than this is held for confirmation. ~200 km/h. */
    static final float MAX_PLAUSIBLE_SPEED_MPS = 55f;
    /** A held fix is confirmed if the next one lands within this of it. */
    static final float JUMP_CONFIRM_RADIUS_M = 50f;
    /**
     * Floor on the time between a held fix and the next one when judging whether
     * they agree, so two fixes delivered in the same instant cannot divide by zero
     * or read as infinitely fast.
     */
    static final long PENDING_MIN_ELAPSED_MS = 1_000L;
    /**
     * Longest a run of accurate fixes may be rejected as jumps before the latest
     * is accepted anyway.
     *
     * The jump gate exists to stop a pin teleporting for one or two bad fixes.
     * Anything that keeps rejecting good fixes for a minute is not filtering noise
     * any more — it is hiding a real position, and a frozen pin in a safety app is
     * the worse failure.
     */
    static final long JUMP_MAX_HOLD_MS = 60_000L;
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
        /**
         * Heartbeat only: push the LAST pushed position again with a fresh
         * timestamp, not this fix. Set when this fix is less precise than the
         * one on the map — a heartbeat is there to say "still here", and letting
         * it write a worse position is what walked a stationary pin ~100m onto a
         * Wi-Fi guess every 90s.
         */
        final boolean keepLastPosition;

        private Result(Outcome outcome, String detail, String note,
                       boolean holdAsPendingJump, boolean clearPendingJump) {
            this(outcome, detail, note, holdAsPendingJump, clearPendingJump, false);
        }

        private Result(Outcome outcome, String detail, String note,
                       boolean holdAsPendingJump, boolean clearPendingJump,
                       boolean keepLastPosition) {
            this.outcome           = outcome;
            this.detail            = detail;
            this.note              = note;
            this.holdAsPendingJump = holdAsPendingJump;
            this.clearPendingJump  = clearPendingJump;
            this.keepLastPosition  = keepLastPosition;
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
     * @param msSincePending time since that held fix; meaningless without one.
     * @param msHoldingJumps how long fixes have been rejected as jumps without a
     *                       break, measured from the first of the run; 0 if none.
     * @param lastPushAccuracyM accuracy of the last pushed fix, or NO_DISTANCE.
     */
    static Result evaluate(float accuracyM,
                           float lastPushAccuracyM,
                           boolean hasLastPush,
                           float movedM,
                           long msSinceLastPush,
                           boolean hasPendingJump,
                           float fromPendingM,
                           long msSincePending,
                           long msHoldingJumps) {

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
            // A held fix is confirmed when this one could plausibly follow it —
            // near it, or a believable distance away for the time between them.
            //
            // The fixed radius alone was not enough. Moving at 100 km/h a bike
            // covers ~140m between 5s fixes, so after a short GPS dropout left the
            // last push behind, no fix could ever land within 50m of the one
            // before it: every fix was rejected for the rest of the ride and the
            // pin froze where the dropout began. A glitch that snaps back is still
            // caught — the snap-back is plausible against the last push and clears
            // the held fix before it is ever confirmed.
            float fromPendingMps = hasPendingJump
                ? fromPendingM / (Math.max(msSincePending, PENDING_MIN_ELAPSED_MS) / 1000f)
                : Float.MAX_VALUE;
            boolean agreesWithPending = hasPendingJump
                && (fromPendingM <= JUMP_CONFIRM_RADIUS_M || fromPendingMps <= MAX_PLAUSIBLE_SPEED_MPS);

            if (agreesWithPending) {
                note = "jump confirmed by second fix (" + movedM + "m, "
                     + (impliedMps * 3.6f) + " km/h implied) — accepting";
                clearPending = true;
            } else if (hasPendingJump && msHoldingJumps >= JUMP_MAX_HOLD_MS) {
                note = "jumps rejected for " + (msHoldingJumps / 1000)
                     + "s — accepting rather than freezing the pin";
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

        // Distance gate, accuracy-aware.
        //
        // A fix only counts as movement when it lands further away than its OWN
        // error. A phone indoors alternates between ~20m GPS fixes and 60-100m
        // Wi-Fi/cell guesses; a 100m-accurate fix 95m from the pin is inside its
        // own uncertainty and says nothing about movement. The flat 15m rule
        // counted it as movement, and the pin flipped ~100m between the two
        // sources while the member sat still (Redmi logs, 2026-09-21).
        float moveThresholdM = Math.max(MIN_MOVE_M,
            accuracyM > COARSE_FIX_ACCURACY_M ? accuracyM * COARSE_FIX_MOVE_FACTOR : accuracyM);
        boolean moved = movedM >= moveThresholdM;
        boolean knownLastAcc = lastPushAccuracyM != NO_DISTANCE && lastPushAccuracyM > 0f;
        // Much more precise than what is on the map: let it correct the pin.
        boolean upgrade = knownLastAcc && accuracyM * UPGRADE_FACTOR <= lastPushAccuracyM
                && movedM >= MIN_MOVE_M;

        if (moved || upgrade) {
            return new Result(Outcome.ACCEPTED,
                "fix accepted — accuracy=" + accuracyM + "m | moved=" + movedM + "m"
                    + (moved ? "" : " (more precise than the last push)"),
                note, false, clearPending);
        }

        if (msSinceLastPush < HEARTBEAT_MS) {
            return new Result(Outcome.SKIPPED_TOO_CLOSE,
                "fix skipped — moved " + movedM + "m (needs " + moveThresholdM + "m), heartbeat in "
                    + ((HEARTBEAT_MS - msSinceLastPush) / 1000) + "s",
                note, false, clearPending);
        }

        // Heartbeat: keep the pin live. Write this fix only if it is at least as
        // precise as the one already on the map; otherwise re-send that one.
        boolean keepLast = knownLastAcc && accuracyM > lastPushAccuracyM;
        return new Result(Outcome.ACCEPTED_HEARTBEAT,
            "fix accepted — accuracy=" + accuracyM + "m | moved=" + movedM + "m"
                + (keepLast ? " (heartbeat keeps the more precise last position)" : ""),
            note, false, clearPending, keepLast);
    }
}
