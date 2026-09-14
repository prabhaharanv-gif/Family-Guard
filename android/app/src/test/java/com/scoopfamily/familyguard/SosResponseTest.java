package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Covers what happens when an SOS is rejected.
 *
 * This is the path that failed silently in the field: a stale token produced a
 * 401, nothing retried, and the gesture reported "SOS could not be sent" with
 * no way for the user to know why. Every branch below used to require sending a
 * real alert to a real family to exercise.
 */
public class SosResponseTest {

    // ── Status classification ────────────────────────────────────────────────

    @Test
    public void successCodes_areRecognised() {
        assertTrue(SosResponse.isOk(200));
        assertTrue("PostgREST answers 201 on insert", SosResponse.isOk(201));
        assertTrue("and 204 when returning nothing", SosResponse.isOk(204));
    }

    @Test
    public void failureCodes_areNotMistakenForSuccess() {
        assertFalse(SosResponse.isOk(401));
        assertFalse(SosResponse.isOk(404));
        assertFalse(SosResponse.isOk(500));
        assertFalse(SosResponse.isOk(SosResponse.NO_RESPONSE));
    }

    @Test
    public void onlyAuthCodes_countAsAuthFailures() {
        assertTrue(SosResponse.isAuthFailure(401));
        assertTrue(SosResponse.isAuthFailure(403));
        assertFalse(SosResponse.isAuthFailure(400));
        assertFalse(SosResponse.isAuthFailure(500));
        assertFalse(SosResponse.isAuthFailure(SosResponse.NO_RESPONSE));
    }

    // ── The retry decision ───────────────────────────────────────────────────

    @Test
    public void aDeliveredAlert_needsNothingFurther() {
        assertEquals(SosResponse.Step.DELIVERED, SosResponse.next(200, true, false));
    }

    /** The bug this whole class exists for. */
    @Test
    public void staleToken_triggersARefreshAndRetry() {
        assertEquals("a 401 must renew the session, not give up",
            SosResponse.Step.REFRESH_AND_RETRY, SosResponse.next(401, false, false));
    }

    @Test
    public void forbidden_alsoTriggersARefresh() {
        assertEquals(SosResponse.Step.REFRESH_AND_RETRY, SosResponse.next(403, false, false));
    }

    /**
     * A Supabase refresh token is single-use. Spending one on a problem a new
     * token cannot fix throws away the credential keeping the user signed in —
     * so a dead network must never trigger a refresh.
     */
    @Test
    public void aRequestThatNeverLanded_doesNotBurnTheRefreshToken() {
        assertEquals("no server response is not an auth problem",
            SosResponse.Step.FAILED,
            SosResponse.next(SosResponse.NO_RESPONSE, false, false));
    }

    @Test
    public void serverErrors_doNotBurnTheRefreshToken() {
        assertEquals(SosResponse.Step.FAILED, SosResponse.next(500, false, false));
        assertEquals(SosResponse.Step.FAILED, SosResponse.next(502, false, false));
        assertEquals(SosResponse.Step.FAILED, SosResponse.next(404, false, false));
        assertEquals(SosResponse.Step.FAILED, SosResponse.next(400, false, false));
    }

    /**
     * Without this the app would refresh, retry, get 401 again, refresh again —
     * in an emergency, on a session that is genuinely dead.
     */
    @Test
    public void aSecondRejection_isFinal() {
        assertEquals("one refresh per request, no loop",
            SosResponse.Step.FAILED, SosResponse.next(401, false, true));
    }

    @Test
    public void successAfterARetry_isStillSuccess() {
        assertEquals(SosResponse.Step.DELIVERED, SosResponse.next(200, true, true));
    }

    /**
     * A 200 carrying nothing usable is a failure, not a success — the caller
     * must not hand a null id to the Cancel action.
     */
    @Test
    public void successCodeWithNoResult_isAFailure() {
        assertEquals(SosResponse.Step.FAILED, SosResponse.next(200, false, false));
    }

    // ── Reading the alert id ─────────────────────────────────────────────────

    @Test
    public void quotedUuid_isUnwrapped() {
        assertEquals("3f2b1c4e-0000-4a1b-9c2d-8e7f6a5b4c3d",
            SosResponse.parseId("\"3f2b1c4e-0000-4a1b-9c2d-8e7f6a5b4c3d\""));
    }

    @Test
    public void surroundingWhitespace_isIgnored() {
        assertEquals("abc", SosResponse.parseId("  \"abc\"\n"));
    }

    @Test
    public void anUnquotedBody_isStillUsed() {
        assertEquals("abc", SosResponse.parseId("abc"));
    }

    @Test
    public void anEmptyBody_yieldsNoId() {
        assertNull(SosResponse.parseId(""));
        assertNull(SosResponse.parseId("   "));
        assertNull("an empty pair of quotes carries no id", SosResponse.parseId("\"\""));
    }

    @Test
    public void aMissingBody_yieldsNoId() {
        assertNull(SosResponse.parseId(null));
    }

    /**
     * Two quote characters and nothing between them is not an id. The length
     * guard is what stops the unwrapping from producing an empty string here.
     */
    @Test
    public void aLoneQuote_isNotTreatedAsAnId() {
        assertEquals("\"", SosResponse.parseId("\""));
    }

    @Test
    public void aJsonErrorObject_isNotMistakenForAnId() {
        String body = "{\"message\":\"JWT expired\"}";
        assertEquals("an error body is not unwrapped into a fake id",
            body, SosResponse.parseId(body));
    }
}
