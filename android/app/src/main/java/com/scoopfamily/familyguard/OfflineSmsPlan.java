package com.scoopfamily.familyguard;

/**
 * Decides when an offline SMS goes out.
 *
 * The app keeps a family informed over the internet. With no data — a 2G-only
 * stretch of road, data switched off, an empty balance — a member simply goes
 * quiet, and their family cannot tell "she is fine and out of coverage" from
 * "something happened". This sends a text with her last known position instead,
 * on the one channel that still works when data does not.
 *
 * Every rule here exists to keep that from becoming a nuisance or a bill:
 *
 *  · FIRST_DELAY_MS — a tunnel, a lift or a train is not an emergency, so
 *    nothing is sent until the phone has been offline a quarter of an hour.
 *  · INTERVAL_MS — one message per recipient per 15 minutes, no more.
 *  · MAX_MESSAGES — a hard cap. A phone left in a dead zone overnight must not
 *    quietly spend somebody's credit; after the cap it stays silent until data
 *    comes back.
 *  · Going back online resets everything, so the next outage starts fresh.
 *
 * Pure Java: no Android types, no clock, no I/O. Times arrive as parameters,
 * which is what makes OfflineSmsPlanTest able to replay a whole outage.
 */
final class OfflineSmsPlan {

    /** How long the phone must be offline before the first message. */
    static final long FIRST_DELAY_MS = 15 * 60 * 1000L;
    /** And between messages after that. */
    static final long INTERVAL_MS    = 15 * 60 * 1000L;
    /** About two hours of alerts, then silence until data returns. */
    static final int  MAX_MESSAGES   = 8;

    enum Action {
        /** Send now. */
        SEND,
        /** Offline, but it is not time yet. */
        WAIT,
        /** The cap is reached; nothing more until the phone is back online. */
        CAP_REACHED,
        /** Online — nothing to do, and the caller clears the counters. */
        ONLINE,
        /** Switched off, or there is nobody to text. */
        NOT_CONFIGURED
    }

    private OfflineSmsPlan() {}

    /**
     * @param enabled        the member turned offline alerts on.
     * @param hasRecipients  at least one usable number is stored.
     * @param offlineSinceMs when connectivity was lost, or 0 while online.
     * @param lastSentMs     when the last offline SMS went out, or 0 if none.
     * @param sentCount      messages sent during THIS outage.
     * @param nowMs          current time.
     */
    static Action decide(boolean enabled, boolean hasRecipients,
                         long offlineSinceMs, long lastSentMs, int sentCount, long nowMs) {
        if (!enabled || !hasRecipients) return Action.NOT_CONFIGURED;
        if (offlineSinceMs <= 0) return Action.ONLINE;

        // A clock that moved backwards (or a stored time from the future) must
        // not unlock an immediate send.
        long offlineFor = nowMs - offlineSinceMs;
        if (offlineFor < FIRST_DELAY_MS) return Action.WAIT;

        if (sentCount >= MAX_MESSAGES) return Action.CAP_REACHED;

        if (lastSentMs > 0 && nowMs - lastSentMs < INTERVAL_MS) return Action.WAIT;

        return Action.SEND;
    }
}
