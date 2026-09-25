package com.scoopfamily.familyguard;

/**
 * How to read a reply from the nearby-help RPCs (accept_nearby_help,
 * decline_nearby_help, get_nearby_help_location), and what to do about it.
 *
 * Mirrors SosResponse exactly, and for the same reason: this is the logic
 * with teeth — retry-or-not, deliver-or-not — split out so it can be unit
 * tested without triggering a real nearby-help escalation to exercise each
 * branch. No Android types, no network, no clock — codes and bodies go in, a
 * verdict comes out.
 *
 * Same two load-bearing rules as SosResponse:
 *   · Only 401 and 403 earn a retry. The stored Supabase refresh token is
 *     single-use, so spending one on a timeout or a dead network — problems a
 *     fresh token cannot fix — throws away the credential that keeps the user
 *     signed in.
 *   · A retry happens at most once.
 *
 * parseLocation() is hand-rolled rather than using org.json, on purpose —
 * same reason SosResponse.parseIds() is: org.json is only a stub on the JVM
 * that runs gradlew testDebugUnitTest, so a class meant to be unit tested
 * cannot depend on it.
 */
final class NearbyHelpResponse {

    private NearbyHelpResponse() {}

    /** What the caller should do next. */
    enum Step {
        /** The RPC succeeded; use the result. */
        DELIVERED,
        /** Auth failed. Renew the session and try once more. */
        REFRESH_AND_RETRY,
        /**
         * Nothing more to try. Covers a genuine failure AND the RPCs' own
         * "already handled" outcomes — accept_nearby_help errors once the
         * escalation is no longer 'searching', and get_nearby_help_location
         * returns zero rows when this device did not win the accept race.
         * Both look identical from here: a non-2xx status with no usable
         * body. The caller (NearbyHelpActionReceiver) is the one that turns
         * this into the "already being handled" notification state rather
         * than a crash.
         */
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
     * @param haveResult     true when the attempt produced what was asked for.
     * @param alreadyRetried true once a refresh has been spent on this request.
     */
    static Step next(int httpCode, boolean haveResult, boolean alreadyRetried) {
        if (haveResult) return Step.DELIVERED;
        if (alreadyRetried) return Step.FAILED;
        if (isAuthFailure(httpCode)) return Step.REFRESH_AND_RETRY;
        return Step.FAILED;
    }

    /**
     * Pulls {lat, lng} out of a get_nearby_help_location reply.
     *
     * get_nearby_help_location RETURNS TABLE(lat double precision, lng double
     * precision), which PostgREST hands back as a JSON array of row objects —
     * one row on success, zero rows when this caller is not the accepted
     * helper (the function's sole reveal-authorization check; see its own
     * doc). Anything that is not exactly one well-formed row — zero rows, a
     * malformed body, missing fields — comes back null, and the caller treats
     * all of those the same way: nothing to reveal.
     */
    static double[] parseLocation(String body) {
        if (body == null) return null;
        String s = body.trim();
        if (!s.startsWith("[") || !s.endsWith("]")) return null;

        String inner = s.substring(1, s.length() - 1).trim();
        if (inner.isEmpty()) return null; // zero rows — not authorized to see it

        int end = inner.indexOf('}');
        String row = end >= 0 ? inner.substring(0, end + 1) : inner;

        Double lat = extractNumber(row, "lat");
        Double lng = extractNumber(row, "lng");
        if (lat == null || lng == null) return null;
        return new double[]{lat, lng};
    }

    /** Hand-rolled number extraction — see the class doc for why. */
    private static Double extractNumber(String row, String key) {
        String needle = "\"" + key + "\"";
        int k = row.indexOf(needle);
        if (k < 0) return null;
        int colon = row.indexOf(':', k + needle.length());
        if (colon < 0) return null;

        int i = colon + 1;
        int n = row.length();
        while (i < n && Character.isWhitespace(row.charAt(i))) i++;
        int start = i;
        while (i < n) {
            char c = row.charAt(i);
            if (!Character.isDigit(c) && c != '-' && c != '+' && c != '.' && c != 'e' && c != 'E') break;
            i++;
        }
        if (i == start) return null;

        try {
            return Double.parseDouble(row.substring(start, i));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
