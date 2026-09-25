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

    /** The general alert's label, exactly as SOSPage writes it. */
    static final String MESSAGE_GENERAL = "SOS! I need help!";
    /**
     * The label of the SOSPage tile for an ambulance. The server derives what
     * Nearby Help tells strangers a person needs from this text
     * (_nearby_help_kind), so a crash has to carry it to be routed to 108
     * rather than defaulting to the police, 100.
     */
    static final String MESSAGE_AMBULANCE = "Need Ambulance";

    /** The stored message for an SOS raised by this trigger. */
    static String messageFor(String source) {
        return "crash".equals(source) ? MESSAGE_AMBULANCE : MESSAGE_GENERAL;
    }

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

    /**
     * Pulls the alert ids out of a send_sos_all_families reply — a JSON array of
     * uuids, one per family — and returns them comma-joined, the form the
     * receipt's Cancel carries. Null when there are none.
     *
     * Parsed by hand rather than with org.json, which is only a stub in JVM
     * unit tests. A uuid never contains a comma, a quote or a bracket.
     */
    static String parseIds(String body) {
        if (body == null) return null;
        String s = body.trim();
        if (!s.startsWith("[") || !s.endsWith("]")) return null;
        StringBuilder out = new StringBuilder();
        for (String part : s.substring(1, s.length() - 1).split(",")) {
            String id = parseId(part);
            if (id == null || id.equals("null")) continue;
            if (out.length() > 0) out.append(',');
            out.append(id);
        }
        return out.length() == 0 ? null : out.toString();
    }

    /**
     * PostgREST answers 404 when the function does not exist — here, when the
     * send_sos_all_families migration has not been applied yet. The caller
     * falls back to the single-family send_sos rather than failing the SOS.
     */
    static boolean isMissingFunction(int httpCode) {
        return httpCode == 404;
    }
}
