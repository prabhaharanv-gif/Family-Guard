package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.scoopfamily.familyguard.RefreshPlan.Action;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

public class RefreshPlanTest {

    private static final long NOW = 1_800_000_000L;
    private static final long FRESH = NOW + 3000;   // ~50 min left
    private static final long STALE = NOW + 60;     // inside the hand-over margin

    // ── The bug: a spent token must never reach the server ──────────────────

    @Test public void spentTokenWithFreshCache_handsOverWithoutSpending() {
        assertEquals(Action.HAND_OVER_CURRENT,
            RefreshPlan.decide("R1", "R2", true, "R2", FRESH, NOW));
    }

    @Test public void spentTokenWithStaleCache_redeemsStoredNotPresented() {
        assertEquals(Action.REDEEM_STORED,
            RefreshPlan.decide("R1", "R2", true, "R2", STALE, NOW));
    }

    @Test public void spentTokenWithCacheForAnotherSession_redeemsStored() {
        // Cache is from an older sign-in; must not hand that session out.
        assertEquals(Action.REDEEM_STORED,
            RefreshPlan.decide("R1", "R2", true, "OLD", FRESH, NOW));
    }

    // ── Normal paths ────────────────────────────────────────────────────────

    @Test public void presentedMatchesStored_redeemsIt() {
        assertEquals(Action.REDEEM_PRESENTED,
            RefreshPlan.decide("R2", "R2", false, "R2", FRESH, NOW));
    }

    @Test public void unknownToken_isTheWebViewsNewSignIn_redeemsIt() {
        assertEquals(Action.REDEEM_PRESENTED,
            RefreshPlan.decide("NEW", "OLD", false, "OLD", FRESH, NOW));
    }

    @Test public void unknownTokenWithNothingStored_redeemsIt() {
        assertEquals(Action.REDEEM_PRESENTED,
            RefreshPlan.decide("NEW", null, false, null, 0, NOW));
    }

    @Test public void nativeCallerAfterWebViewRenewed_usesStoredWithoutSpending() {
        assertEquals(Action.HAND_OVER_CURRENT,
            RefreshPlan.decide(null, "R2", false, "R2", FRESH, NOW));
    }

    @Test public void nativeCallerWithStaleCache_redeemsStored() {
        assertEquals(Action.REDEEM_STORED,
            RefreshPlan.decide(null, "R2", false, "R2", STALE, NOW));
    }

    @Test public void nativeCallerWithPushedPairNotInCache_redeemsStored() {
        assertEquals(Action.REDEEM_STORED,
            RefreshPlan.decide(null, "PUSHED", false, "R2", FRESH, NOW));
    }

    @Test public void nothingAnywhere_isSignedOut() {
        assertEquals(Action.NOTHING_TO_REDEEM,
            RefreshPlan.decide(null, null, false, null, 0, NOW));
    }

    // ── Pushed pairs ────────────────────────────────────────────────────────

    @Test public void spentTokenMayNotBeStored() {
        assertFalse(RefreshPlan.mayStore("R1", Arrays.asList("R0", "R1")));
    }

    @Test public void freshTokenMayBeStored() {
        assertTrue(RefreshPlan.mayStore("R3", Arrays.asList("R1", "R2")));
    }

    @Test public void emptyTokenMayNotBeStored() {
        assertFalse(RefreshPlan.mayStore("", Collections.emptyList()));
        assertFalse(RefreshPlan.mayStore(null, Collections.emptyList()));
    }

    // ── Spent list bookkeeping ──────────────────────────────────────────────

    @Test public void rememberCapsAndDropsOldest() {
        List<String> spent = new ArrayList<>();
        for (int i = 0; i < RefreshPlan.MAX_SPENT + 3; i++) spent = RefreshPlan.remember(spent, "R" + i);
        assertEquals(RefreshPlan.MAX_SPENT, spent.size());
        assertFalse(spent.contains("R0"));
        assertTrue(spent.contains("R" + (RefreshPlan.MAX_SPENT + 2)));
    }

    @Test public void rememberIgnoresDuplicatesAndBlanks() {
        List<String> spent = RefreshPlan.remember(Arrays.asList("R1"), "R1");
        spent = RefreshPlan.remember(spent, "");
        spent = RefreshPlan.remember(spent, null);
        assertEquals(Arrays.asList("R1"), spent);
    }

    @Test public void spentListRoundTrips() {
        List<String> spent = Arrays.asList("a", "b", "c");
        assertEquals(spent, RefreshPlan.parseSpent(RefreshPlan.joinSpent(spent)));
        assertTrue(RefreshPlan.parseSpent(null).isEmpty());
        assertTrue(RefreshPlan.parseSpent("").isEmpty());
    }
}
