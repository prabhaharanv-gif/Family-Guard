package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Replying to a message from its notification: what is sent, and to whom. */
public class ReplyPlanTest {

    @Test
    public void emptyOrBlankReply_sendsNothing() {
        assertNull(ReplyPlan.clean(null));
        assertNull(ReplyPlan.clean(""));
        assertNull(ReplyPlan.clean("   \n  "));
    }

    @Test
    public void reply_isTrimmed() {
        assertEquals("on my way", ReplyPlan.clean("  on my way \n"));
    }

    @Test
    public void reply_keepsInnerWhitespaceAndUnicode() {
        assertEquals("ok  👍", ReplyPlan.clean("ok  👍"));
    }

    @Test
    public void longReply_isCutToTheServerLimit_notRefused() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ReplyPlan.MAX_LENGTH + 500; i++) sb.append('a');
        String out = ReplyPlan.clean(sb.toString());
        assertEquals(ReplyPlan.MAX_LENGTH, out.length());
    }

    @Test
    public void groupReply_needsOnlyTheFamily() {
        assertTrue(ReplyPlan.canReply("fam-1", false, null));
        assertFalse(ReplyPlan.canReply(null, false, null));
        assertFalse(ReplyPlan.canReply("  ", false, null));
    }

    @Test
    public void privateReply_alsoNeedsWhoToAnswer() {
        assertTrue(ReplyPlan.canReply("fam-1", true, "user-9"));
        assertFalse("an older push carries no sender id", ReplyPlan.canReply("fam-1", true, null));
        assertFalse(ReplyPlan.canReply("fam-1", true, ""));
    }

    @Test
    public void rpcMatchesTheKindOfMessage() {
        assertEquals("send_message", ReplyPlan.rpcFor(false));
        assertEquals("send_direct_message", ReplyPlan.rpcFor(true));
    }
}
