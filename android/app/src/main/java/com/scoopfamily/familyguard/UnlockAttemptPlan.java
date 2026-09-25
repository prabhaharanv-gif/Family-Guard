package com.scoopfamily.familyguard;

/**
 * When do wrong screen-lock attempts become a report?
 *
 * Android tells a device-admin app about each failed unlock one at a time, in a
 * receiver that is created fresh for every broadcast, so the running count has
 * to live in storage. This class is the rule only: the state comes in, the new
 * state and the verdict come out. No Android types and no clock, so it runs on a
 * plain JVM (UnlockAttemptPlanTest).
 *
 * The rule:
 *  - Failures count only while they are close together: a failure more than
 *    WINDOW_MS after the first of the current run starts a new run, so three
 *    typos spread over a week are not an intruder.
 *  - The report is raised on the ATTEMPTS_TO_REPORT-th failure of a run.
 *  - After a report nothing more is raised for COOLDOWN_MS, so a thief who keeps
 *    guessing does not send the family a stream of alerts.
 *  - A correct unlock ends the run.
 */
final class UnlockAttemptPlan {

    static final int  ATTEMPTS_TO_REPORT = 3;
    static final long WINDOW_MS   = 10 * 60_000L;
    static final long COOLDOWN_MS = 10 * 60_000L;

    private UnlockAttemptPlan() {}

    /** The persisted state. Immutable; every step returns a new one. */
    static final class State {
        final int  failures;
        final long firstFailAtMs;
        final long lastReportAtMs;   // Long.MIN_VALUE = never
        /** Set on the state returned by onFailed when a report should go out. */
        final boolean report;
        /** How many attempts the report should say. */
        final int attempts;

        State(int failures, long firstFailAtMs, long lastReportAtMs, boolean report, int attempts) {
            this.failures = failures;
            this.firstFailAtMs = firstFailAtMs;
            this.lastReportAtMs = lastReportAtMs;
            this.report = report;
            this.attempts = attempts;
        }
    }

    static State initial() {
        return new State(0, 0L, Long.MIN_VALUE, false, 0);
    }

    static State onFailed(State s, long nowMs) {
        int  failures = s.failures;
        long first    = s.firstFailAtMs;
        if (failures == 0 || nowMs - first > WINDOW_MS) {
            failures = 0;
            first = nowMs;
        }
        failures++;

        boolean cooling = s.lastReportAtMs != Long.MIN_VALUE && nowMs - s.lastReportAtMs < COOLDOWN_MS;
        if (failures >= ATTEMPTS_TO_REPORT && !cooling) {
            // The run is spent: start counting afresh after the report.
            return new State(0, 0L, nowMs, true, failures);
        }
        return new State(failures, first, s.lastReportAtMs, false, failures);
    }

    static State onSucceeded(State s) {
        return new State(0, 0L, s.lastReportAtMs, false, 0);
    }
}
