package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;

import com.scoopfamily.familyguard.OfflineSmsPlan.Action;

import org.junit.Test;

/**
 * Covers when an offline SMS is sent.
 *
 * These messages cost the sender real money and arrive on someone else's phone
 * at any hour, so the tests lean on the side of not sending: the outage has to
 * be long enough, spaced enough, and under the cap.
 */
public class OfflineSmsPlanTest {

    private static final long MIN = 60 * 1000L;
    private static final long NOW = 1_800_000_000_000L;

    private static Action decide(long offlineSince, long lastSent, int count, long now) {
        return OfflineSmsPlan.decide(true, true, offlineSince, lastSent, count, now);
    }

    // ── Nothing to do ────────────────────────────────────────────────────────

    @Test public void switchedOff_sendsNothing() {
        assertEquals(Action.NOT_CONFIGURED,
            OfflineSmsPlan.decide(false, true, NOW - 60 * MIN, 0, 0, NOW));
    }

    @Test public void noRecipients_sendsNothing() {
        assertEquals(Action.NOT_CONFIGURED,
            OfflineSmsPlan.decide(true, false, NOW - 60 * MIN, 0, 0, NOW));
    }

    @Test public void online_sendsNothing() {
        assertEquals(Action.ONLINE, decide(0, 0, 0, NOW));
    }

    // ── The first message ────────────────────────────────────────────────────

    @Test public void briefDrop_waits() {
        // A tunnel, a lift, a basement: offline, but not for long.
        assertEquals(Action.WAIT, decide(NOW - 2 * MIN, 0, 0, NOW));
        assertEquals(Action.WAIT, decide(NOW - 14 * MIN, 0, 0, NOW));
    }

    @Test public void fifteenMinutesOffline_sends() {
        assertEquals(Action.SEND, decide(NOW - 15 * MIN, 0, 0, NOW));
    }

    // ── The rhythm after that ────────────────────────────────────────────────

    @Test public void tooSoonAfterTheLastMessage_waits() {
        assertEquals(Action.WAIT, decide(NOW - 40 * MIN, NOW - 14 * MIN, 1, NOW));
    }

    @Test public void aQuarterHourAfterTheLast_sendsAgain() {
        assertEquals(Action.SEND, decide(NOW - 40 * MIN, NOW - 15 * MIN, 1, NOW));
    }

    @Test public void theCapStopsIt() {
        assertEquals(Action.CAP_REACHED,
            decide(NOW - 5 * 60 * MIN, NOW - 60 * MIN, OfflineSmsPlan.MAX_MESSAGES, NOW));
    }

    @Test public void oneShortOfTheCap_stillSends() {
        assertEquals(Action.SEND,
            decide(NOW - 5 * 60 * MIN, NOW - 60 * MIN, OfflineSmsPlan.MAX_MESSAGES - 1, NOW));
    }

    /** Two hours of alerts is the intended budget at one every 15 minutes. */
    @Test public void theCapIsAboutTwoHours() {
        assertEquals(2 * 60, OfflineSmsPlan.MAX_MESSAGES * OfflineSmsPlan.INTERVAL_MS / MIN);
    }

    // ── Clock oddities ───────────────────────────────────────────────────────

    @Test public void aClockThatWentBackwards_doesNotUnlockASend() {
        // offlineSince in the future: elapsed is negative, which must read as
        // "not long enough" rather than sailing past the delay.
        assertEquals(Action.WAIT, decide(NOW + 60 * MIN, 0, 0, NOW));
    }

    @Test public void aLastSentTimeInTheFuture_holds() {
        assertEquals(Action.WAIT, decide(NOW - 60 * MIN, NOW + 5 * MIN, 1, NOW));
    }
}
