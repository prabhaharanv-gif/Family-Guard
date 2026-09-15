package com.scoopfamily.familyguard;

import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * The only place in the app that redeems a Supabase refresh token.
 *
 * Both the WebView (via the fetch wrapper in src/lib/refreshBroker.js) and the
 * native callers (location pushes, SOS, location status) come through here, one
 * at a time. See RefreshPlan for why two independent refreshers signed users out.
 *
 * This replaces the earlier foreground/background ownership split. That split
 * could not hold: supabase-js renews on its own from inside getSession(), which
 * the Realtime heartbeat calls every ~25s even while the app is backgrounded, so
 * the WebView kept spending the token in the window it had promised to leave to
 * the service.
 */
final class TokenBroker {

    private static final String TAG = "TokenBroker";

    /** Full JSON of the last session obtained here, with an absolute expires_at. */
    static final String KEY_SESSION_JSON = "session_json";
    /** Newline-joined refresh tokens this device has already redeemed. */
    static final String KEY_SPENT        = "spent_refresh_tokens";

    private TokenBroker() {}

    /** status is the HTTP code, or 0 when the request never reached the server. */
    static final class Result {
        final int    status;
        final String body;
        Result(int status, String body) { this.status = status; this.body = body; }
        boolean ok() { return status == 200; }
    }

    /**
     * Renews the session.
     *
     * @param presented the refresh token the caller holds, or null to renew
     *                  whatever is stored (native callers).
     */
    static synchronized Result redeem(SharedPreferences prefs, String supabaseUrl,
                                      String supabaseKey, String presented) {
        String stored = prefs.getString(LocationForegroundService.KEY_REFRESH, null);
        if (stored != null && stored.isEmpty()) stored = null;
        List<String> spent = RefreshPlan.parseSpent(prefs.getString(KEY_SPENT, null));

        String cachedJson = prefs.getString(KEY_SESSION_JSON, null);
        String cachedRefresh = null;
        long cachedExpiresAt = 0;
        if (cachedJson != null) {
            try {
                JSONObject c = new JSONObject(cachedJson);
                cachedRefresh   = c.optString("refresh_token", null);
                cachedExpiresAt = c.optLong("expires_at", 0);
            } catch (Exception ignored) {}
        }
        long now = System.currentTimeMillis() / 1000;

        RefreshPlan.Action action = RefreshPlan.decide(
            presented, stored, presented != null && spent.contains(presented),
            cachedRefresh, cachedExpiresAt, now);

        switch (action) {
            case NOTHING_TO_REDEEM:
                Log.w(TAG, "No refresh token stored — cannot renew session");
                return new Result(0, null);

            case HAND_OVER_CURRENT:
                Log.i(TAG, "Session already renewed — handing over the current one, nothing spent");
                return new Result(200, withExpiresIn(cachedJson, now));

            case REDEEM_STORED:
                if (presented != null) {
                    Log.i(TAG, "Caller held a spent token — renewing the stored one instead");
                }
                return post(prefs, supabaseUrl, supabaseKey, stored, spent, now);

            case REDEEM_PRESENTED:
            default:
                return post(prefs, supabaseUrl, supabaseKey, presented, spent, now);
        }
    }

    /**
     * Stores a pair pushed down from JS, unless its refresh token is one this
     * device already spent. Letting a stale push land would make the next
     * redemption present a revoked token and kill the live session.
     */
    static synchronized void store(SharedPreferences prefs, String access, String refresh) {
        List<String> spent = RefreshPlan.parseSpent(prefs.getString(KEY_SPENT, null));
        if (refresh != null && !refresh.isEmpty() && !RefreshPlan.mayStore(refresh, spent)) {
            Log.i(TAG, "Ignored a pushed session whose refresh token was already spent");
            return;
        }
        SharedPreferences.Editor editor = prefs.edit();
        if (access != null) editor.putString(LocationForegroundService.KEY_SESSION, access);
        if (refresh != null && !refresh.isEmpty()) {
            editor.putString(LocationForegroundService.KEY_REFRESH, refresh);
        }
        editor.commit();
    }

    private static Result post(SharedPreferences prefs, String supabaseUrl, String supabaseKey,
                               String token, List<String> spent, long now) {
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("refresh_token", token);

            URL url = new URL(supabaseUrl + "/auth/v1/token?grant_type=refresh_token");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + supabaseKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            String text = read(code == 200 ? conn.getInputStream() : conn.getErrorStream());

            if (code != 200) {
                // Passed back untouched, so supabase-js reacts exactly as it would
                // to the server — a 5xx stays retryable, a dead token stays dead.
                Log.w(TAG, "Token refresh failed HTTP " + code + " — " + text);
                return new Result(code, text);
            }

            JSONObject json = new JSONObject(text);
            String newAccess  = json.optString("access_token", null);
            String newRefresh = json.optString("refresh_token", null);
            if (newAccess == null || newRefresh == null) {
                Log.w(TAG, "Token refresh response missing tokens");
                return new Result(502, text);
            }
            if (!json.has("expires_at")) {
                json.put("expires_at", now + json.optLong("expires_in", 3600));
            }

            // commit, not apply: the next caller in line reads these immediately.
            prefs.edit()
                .putString(LocationForegroundService.KEY_SESSION, newAccess)
                .putString(LocationForegroundService.KEY_REFRESH, newRefresh)
                .putString(KEY_SESSION_JSON, json.toString())
                .putString(KEY_SPENT, RefreshPlan.joinSpent(RefreshPlan.remember(spent, token)))
                .commit();

            Log.i(TAG, "✅ Session renewed");
            return new Result(200, json.toString());
        } catch (Exception e) {
            // Offline or timed out. Status 0 tells JS to treat it as a network
            // failure, which keeps the stored session.
            Log.e(TAG, "Token refresh error: " + e.getMessage());
            return new Result(0, null);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** The cached session with expires_in recomputed for the moment it is handed over. */
    private static String withExpiresIn(String cachedJson, long now) {
        try {
            JSONObject c = new JSONObject(cachedJson);
            c.put("expires_in", Math.max(0, c.optLong("expires_at", now) - now));
            return c.toString();
        } catch (Exception e) {
            return cachedJson;
        }
    }

    private static String read(InputStream in) {
        if (in == null) return "";
        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
