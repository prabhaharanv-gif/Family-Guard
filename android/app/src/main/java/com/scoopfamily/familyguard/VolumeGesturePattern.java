package com.scoopfamily.familyguard;

/**
 * Decides whether a run of volume presses is the SOS gesture: two presses one
 * way, then two the other.
 *
 * Deliberately free of every Android type — no Context, no Log, no clock. Time
 * arrives as a parameter and the answer comes back as a value, so the whole
 * state machine runs on a plain JVM and can be tested without a device.
 *
 * That split exists because of how this logic was checked before it had tests.
 * Every case below — too fast, too slow, too many in one direction, a reversal
 * that comes too early — was confirmed by pressing buttons on one phone and
 * reading logcat, which is slow, needs a human, and misses things: a bug where
 * the gesture reported itself as down-first no matter which way it was actually
 * performed survived that process and was spotted by eye in a log afterwards.
 *
 * Cooldown is not handled here. It belongs to SosArming, which is shared with
 * every other trigger and owns the clock.
 */
final class VolumeGesturePattern {

    /** Presses in each direction: two one way, then two the other. */
    static final int  RUN_LENGTH = 2;
    /** The whole four-press pattern must land inside this. */
    static final long WINDOW_MS  = 5000;
    /** Closer than this and it is one press reported twice, not two presses. */
    static final long MIN_GAP_MS = 120;
    /**
     * A fresh pattern may only begin after this much volume silence.
     *
     * Without it, a long run of presses contains the pattern by accident: press
     * up five times and the run resets partway, leaving the last two ups as the
     * start of a new pattern, so two downs afterwards would fire.
     */
    static final long QUIET_BEFORE_MS = 1000;

    /** What a press did to the run. */
    enum Outcome {
        /** Counted towards the pattern; nothing more to do. */
        COUNTED,
        /** Arrived too soon after the previous one — the same press, twice. */
        IGNORED_DEBOUNCE,
        /** Would have begun a pattern, but followed other presses too closely. */
        IGNORED_NOT_QUIET,
        /** Began a run, discarding whatever was in progress. */
        STARTED,
        /** The run in progress was abandoned; this press did not start a new one. */
        RESET,
        /** Four presses, correctly shaped, inside the window. */
        ARMED
    }

    /** The answer to one press: an outcome, a sentence for the log, and a label when armed. */
    static final class Result {
        final Outcome outcome;
        final String  detail;
        /** Non-null only when outcome is ARMED. */
        final String  source;

        private Result(Outcome outcome, String detail, String source) {
            this.outcome = outcome;
            this.detail  = detail;
            this.source  = source;
        }

        static Result of(Outcome outcome, String detail) { return new Result(outcome, detail, null); }
        static Result armed(String source)               { return new Result(Outcome.ARMED, source + " recognised", source); }

        boolean isArmed() { return outcome == Outcome.ARMED; }
    }

    /** +1 for the up run, -1 for the down run, 0 before anything is seen. */
    private int  firstDirection = 0;
    private int  firstRunCount  = 0;
    private int  secondRunCount = 0;
    private long runStartedAt   = 0;
    private long lastPressAt    = 0;

    /**
     * Feeds one press in.
     *
     * @param direction +1 for volume up, -1 for volume down.
     * @param now       millisecond clock, supplied by the caller.
     */
    Result press(int direction, long now) {
        // One press can arrive as several events — the key itself and the
        // volume change it causes. Collapse them.
        if (lastPressAt > 0 && now - lastPressAt < MIN_GAP_MS) {
            return Result.of(Outcome.IGNORED_DEBOUNCE,
                dirName(direction) + " ignored — only " + (now - lastPressAt)
                    + "ms since the last, treated as one press");
        }

        String prefix = "";
        // Too slow: this press cannot belong to the run in progress, but it may
        // be the first of a new one.
        if (firstDirection != 0 && now - runStartedAt > WINDOW_MS) {
            prefix = dirName(direction) + " — " + (now - runStartedAt)
                   + "ms since the run began, too slow, starting again; ";
            resetRun();
        }

        long sinceLast = lastPressAt > 0 ? now - lastPressAt : Long.MAX_VALUE;
        lastPressAt = now;

        if (firstDirection == 0) {
            if (sinceLast < QUIET_BEFORE_MS) {
                return Result.of(Outcome.IGNORED_NOT_QUIET,
                    prefix + dirName(direction) + " — only " + sinceLast
                        + "ms of quiet, not treating this as the start of a pattern");
            }
            return begin(direction, now, prefix);
        }

        if (secondRunCount == 0 && direction == firstDirection) {
            // Still building the first run. More than RUN_LENGTH in the same
            // direction means this is someone changing the volume, not a
            // gesture — a pocket does exactly this — so give up on the run.
            firstRunCount++;
            if (firstRunCount > RUN_LENGTH) {
                resetRun();
                return Result.of(Outcome.RESET,
                    prefix + "too many " + dirName(direction) + " presses — not the gesture, resetting");
            }
            return Result.of(Outcome.COUNTED,
                prefix + dirName(direction) + " " + firstRunCount + "/" + RUN_LENGTH);
        }

        if (direction == firstDirection) {
            // Reversed back again after starting the second run. Not the
            // pattern; treat this press as the start of a fresh attempt.
            resetRun();
            return begin(direction, now, prefix + "direction flipped back — restarting from this press; ");
        }

        // Opposite direction — the reversal. The first run may be one press or
        // two, and that tolerance is not sloppiness: measured on the Redmi with
        // the screen off, the routing path drops the FIRST press of every
        // gesture and sometimes a second. Three attempts at up-up-down-down
        // arrived as 3, 2 and 3 presses, never 4. Requiring exactly two before
        // the reversal made the gesture unreachable in the one situation it
        // exists for.
        //
        // The user still performs two one way then two the other. This only
        // means the run survives losing one of them.
        secondRunCount++;
        if (secondRunCount < RUN_LENGTH) {
            return Result.of(Outcome.COUNTED,
                prefix + dirName(direction) + " " + secondRunCount + "/" + RUN_LENGTH + " (second run)");
        }

        // Read both before resetRun clears them — it zeroes firstDirection, so
        // deriving the label afterwards reported every gesture as down-first.
        long   span   = now - runStartedAt;
        String source = firstDirection > 0 ? "volume-up2-down2" : "volume-down2-up2";
        resetRun();

        if (span > WINDOW_MS) {
            return Result.of(Outcome.RESET,
                prefix + "pattern complete but spanned " + span + "ms, over the " + WINDOW_MS + "ms window");
        }
        return Result.armed(source);
    }

    private Result begin(int direction, long now, String prefix) {
        firstDirection = direction;
        firstRunCount  = 1;
        runStartedAt   = now;
        return Result.of(Outcome.STARTED,
            prefix + "pattern started with " + dirName(direction) + " 1/" + RUN_LENGTH);
    }

    /**
     * Throws away the run in progress. Used when something outside the pattern
     * invalidates it — the post-send cooldown, or the detector being restarted.
     * Does not clear the debounce, which is about physical presses, not runs.
     */
    void reset() {
        resetRun();
    }

    private void resetRun() {
        firstDirection = 0;
        firstRunCount  = 0;
        secondRunCount = 0;
        runStartedAt   = 0;
    }

    static String dirName(int direction) {
        return direction > 0 ? "UP" : "DOWN";
    }
}
