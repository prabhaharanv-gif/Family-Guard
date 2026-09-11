package com.scoopfamily.familyguard;

/**
 * How to read a reply from the SOS RPCs, and what to do about it.
 *
 * Split out of SosSender because the decisions here are the ones with teeth,
 * and testing them in place would mean sending a real alert to a real family to
 * exercise each branch. No Android types, no network, no clock — codes and
 * bodies go in, a verdict comes out.
 *
 * Two rules here are load-bearing and easy to get wrong:
 *
 *   · Only 401 and 403 earn a retry. A Supabase refresh token is single-use, so
 *     spending one on a timeout or a dead network — problems a fresh token
 *     cannot fix — throws away the credential that keeps the user signed in.
 *   · A retry happens at most once. The second rejection is final, or a phone
 *     with a genuinely dead session would sit in a refresh loop during an
 *     emergency.
 */
final class SosResponse {

    private SosResponse() {}

    /** What the caller should do next. */
    enum Step {
        /** The alert is in; use the id. */
        DELIVERED,
        /** Auth failed. Renew the session and try once more. */
        REFRESH_AND_RETRY,
        /** Nothing more to try. */
        FAILED
    }

    /** Reported by a request that never reached the server at all. */
    static final int NO_RESPONSE = 0;

    static boolean isOk(int httpCode) {
        return httpCode == 200 || httpCode == 201 || httpCode == 204;
    }

    static boolean isAuthFailure(int httpCode) {
        return httpCode == 401 || httpCode == 403;
    }

    /**
     * Decides what to do after one attempt.
     *
     * @param httpCode       status returned, or NO_RESPONSE if the request threw.
     * @param haveResult     true when the attempt produced what was asked for —
     *                       an alert id for a send, a success code for a cancel.
     * @param alreadyRetried true once a refresh has been spent on this request.
     */
    static Step next(int httpCode, boolean haveResult, boolean alreadyRetried) {
        if (haveResult) return Step.DELIVERED;
        if (alreadyRetried) return Step.FAILED;
        if (isAuthFailure(httpCode)) return Step.REFRESH_AND_RETRY;
        // Everything else — a 500, a 404, or a request that never landed —
        // is not something a new token repairs.
        return Step.FAILED;
    }

    /**
     * Pulls the alert id out of a send_sos reply.
     *
     * send_sos RETURNS uuid, which PostgREST hands back as a bare JSON scalar —
     * a quoted string, not an object. Anything that does not look like an id
     * comes back null so the caller reports a failure rather than carrying a
     * meaningless value into the cancel action.
     */
    static String parseId(String body) {
        if (body == null) return null;
        String id = body.trim();
        // >= 2, not > 2. The original guard skipped a two-character body, so an
        // empty quoted string came back as the two quote characters themselves
        // and was then treated as a real alert id — producing an "SOS sent"
        // receipt whose Cancel button could never work.
        if (id.length() >= 2 && id.startsWith("\"") && id.endsWith("\"")) {
            id = id.substring(1, id.length() - 1);
        }
        return id.isEmpty() ? null : id;
    }
}
