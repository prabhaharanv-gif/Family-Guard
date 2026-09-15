package com.scoopfamily.familyguard;

import java.util.ArrayList;
import java.util.List;

/**
 * Decides what to do with a request to renew the Supabase session.
 *
 * Split out of TokenBroker so the rules can be unit tested without Android,
 * the network, or a clock. Tokens and times go in, a verdict comes out.
 *
 * Why the rules exist. A Supabase refresh token is single-use: redeeming it
 * issues a replacement and revokes it. Presenting a revoked one again is
 * treated as token theft — the server answers "Invalid Refresh Token: Already
 * Used" and revokes the whole session, including the replacement. Two things in
 * this app hold the token: the WebView (supabase-js) and the native side
 * (location service, SOS sender). Any time both redeemed the same token, the
 * user was signed out everywhere — which is the "logged out by itself, at no
 * particular moment" bug.
 *
 * So all redemption goes through one lock, and a request carrying a token that
 * this device has already spent is answered with the session that replaced it
 * instead of being sent to the server.
 */
final class RefreshPlan {

    private RefreshPlan() {}

    enum Action {
        /** Send the token the caller presented to the server. */
        REDEEM_PRESENTED,
        /** Send the token currently in storage (the caller's is stale or absent). */
        REDEEM_STORED,
        /** Someone already renewed; answer with the stored session, spend nothing. */
        HAND_OVER_CURRENT,
        /** No token anywhere — the user is signed out. */
        NOTHING_TO_REDEEM
    }

    /**
     * A handed-over session must have at least this long left, or the caller
     * would get a token that expires in their hands and ask again at once.
     */
    static final long MIN_HANDOVER_LIFE_SEC = 120;

    /** How many spent tokens to remember. Rotation is roughly hourly. */
    static final int MAX_SPENT = 8;

    /**
     * @param presented         the token the caller wants redeemed; null for a
     *                          native caller that just means "renew whatever is stored".
     * @param stored            the refresh token in storage, or null.
     * @param presentedWasSpent true if this device already redeemed `presented`.
     * @param cachedRefresh     refresh token of the last session the broker
     *                          obtained, or null.
     * @param cachedExpiresAt   that session's access-token expiry, epoch seconds.
     * @param nowSec            the current time, epoch seconds.
     */
    static Action decide(String presented, String stored, boolean presentedWasSpent,
                         String cachedRefresh, long cachedExpiresAt, long nowSec) {
        boolean cacheIsCurrent = stored != null && stored.equals(cachedRefresh)
                && cachedExpiresAt - nowSec > MIN_HANDOVER_LIFE_SEC;

        if (presented == null) {
            if (stored == null) return Action.NOTHING_TO_REDEEM;
            // A native 401 right after the WebView renewed: the caller read the
            // old access token. The new one is already stored — use it.
            return cacheIsCurrent ? Action.HAND_OVER_CURRENT : Action.REDEEM_STORED;
        }

        if (presented.equals(stored)) return Action.REDEEM_PRESENTED;

        if (presentedWasSpent && stored != null) {
            // The whole point: never send a spent token to the server.
            return cacheIsCurrent ? Action.HAND_OVER_CURRENT : Action.REDEEM_STORED;
        }

        // A token this device has never seen — the WebView's own fresh sign-in,
        // before it has pushed the pair down. It is the newest truth; redeem it.
        return Action.REDEEM_PRESENTED;
    }

    /**
     * Whether a token pushed down from JS may overwrite storage. A spent token
     * must not: it would be redeemed next and revoke the live session.
     */
    static boolean mayStore(String refresh, List<String> spent) {
        return refresh != null && !refresh.isEmpty() && !spent.contains(refresh);
    }

    /** Adds a spent token, newest last, capped at MAX_SPENT. */
    static List<String> remember(List<String> spent, String token) {
        List<String> out = new ArrayList<>(spent);
        if (token == null || token.isEmpty() || out.contains(token)) return out;
        out.add(token);
        while (out.size() > MAX_SPENT) out.remove(0);
        return out;
    }

    static List<String> parseSpent(String joined) {
        List<String> out = new ArrayList<>();
        if (joined == null) return out;
        for (String s : joined.split("\n")) if (!s.isEmpty()) out.add(s);
        return out;
    }

    static String joinSpent(List<String> spent) {
        return String.join("\n", spent);
    }
}
