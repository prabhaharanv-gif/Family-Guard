package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Raises an SOS without the app being open.
 *
 * SOSPage does this from JS through supabase.rpc('send_sos', ...), which needs
 * a live WebView. The whole point of the power-button gesture is that the app
 * is closed and the phone may be in a pocket, so the same RPC is called here
 * over plain HTTP using the session the location service already keeps in
 * SharedPreferences for its own pushes.
 *
 * Everything needed is already stored — url, anon key, family id, access token
 * — because LocationForegroundService has been posting locations with it for
 * months. This adds no new state and no new permissions.
 *
 * Stale tokens, and why this refreshes where the push path waits
 * --------------------------------------------------------------
 * The access token expires about an hour after login, so both RPCs here can be
 * rejected with a 401 through no fault of the caller. This was observed for
 * real: a gesture that counted correctly and armed correctly still ended in
 * "SOS could not be sent", because the stored token had gone stale.
 *
 * Both calls therefore renew the session and retry once. That deliberately
 * departs from the location push in LocationForegroundService, which defers to
 * the WebView while the app is in the foreground: a Supabase refresh token is
 * single-use, so redeeming one natively while JS holds the same token produces
 * "Invalid Refresh Token: Already Used" and drops the user on the login screen.
 *
 * A push can afford to wait ~95s for the next heartbeat. An SOS cannot. The
 * worst case of refreshing here is that someone has to sign in again; the worst
 * case of waiting is that the alert never goes out. Note that the gesture only
 * fires with the app closed, which is precisely when the WebView is not holding
 * the token anyway, so the collision is unlikely in the first place.
 *
 * Which rejections earn a retry, and the rule that a retry happens at most
 * once, live in SosResponse — extracted so they can be unit tested, because
 * exercising them here would mean sending real alerts to a real family.
 */
final class SosSender {

    private static final String TAG = "SOS_Native";

    private SosSender() {}

    /**
     * Posts an SOS to the member's active family. Blocking — call it off the
     * main thread.
     *
     * @param source recorded in the log only, so a native send can be told
     *               apart from the in-app one when reading logcat.
     * @return the new alert's id, or null if nothing was sent. The id is what
     *         makes the alert cancellable from the notification without opening
     *         the app — send_sos returns it, so there is no second lookup and no
     *         guessing which alert was ours.
     */
    static String send(Context ctx, Location loc, String source) {
        SharedPreferences prefs =
            ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);

        String supabaseUrl = prefs.getString(LocationForegroundService.KEY_URL, null);
        String supabaseKey = prefs.getString(LocationForegroundService.KEY_KEY, null);
        String familyId    = prefs.getString(LocationForegroundService.KEY_FAMILY_ID, null);
        String session     = prefs.getString(LocationForegroundService.KEY_SESSION, null);

        if (supabaseUrl == null || supabaseKey == null || familyId == null) {
            Log.w(TAG, "Cannot send — the service has no Supabase config stored yet");
            return null;
        }
        if (session == null) {
            // send_sos is SECURITY DEFINER and resolves the sender from
            // auth.uid(); the anon key would arrive as `anon` and be rejected.
            // Better to say so than to post something that cannot succeed.
            Log.w(TAG, "Cannot send — no session token, the user is signed out");
            return null;
        }

        Attempt a = postSos(supabaseUrl, supabaseKey, familyId, session, loc, source);
        switch (SosResponse.next(a.code, a.id != null, false)) {
            case DELIVERED:
                return a.id;

            case REFRESH_AND_RETRY:
                Log.w(TAG, "SOS rejected (" + source + ") — HTTP " + a.code
                         + ", renewing the session and retrying once");
                if (!LocationForegroundService.refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                    Log.w(TAG, "Could not renew the session — refresh token missing or expired, "
                             + "the user must reopen the app to sign in again");
                    return null;
                }
                String renewed = prefs.getString(LocationForegroundService.KEY_SESSION, null);
                a = postSos(supabaseUrl, supabaseKey, familyId, renewed, loc, source);
                if (SosResponse.next(a.code, a.id != null, true) == SosResponse.Step.DELIVERED) {
                    Log.i(TAG, "SOS delivered after a native session refresh");
                    return a.id;
                }
                Log.w(TAG, "SOS still rejected after the refresh — HTTP " + a.code);
                return null;

            default:
                // Not an auth problem, so no retry — but it still has to be said.
                // NO_RESPONSE means the request threw and postSos already logged why.
                if (a.code != SosResponse.NO_RESPONSE) {
                    Log.w(TAG, "SOS rejected (" + source + ") — HTTP " + a.code);
                }
                return null;
        }
    }

    /**
     * One attempt at send_sos.
     *
     * @param session the bearer token to try; the caller supplies a renewed one
     *                on the second attempt.
     */
    private static Attempt postSos(String supabaseUrl, String supabaseKey, String familyId,
                                   String session, Location loc, String source) {
        if (session == null) return new Attempt(SosResponse.NO_RESPONSE, null);

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_family_id", familyId);
            // 0,0 is what the JS path sends when it cannot get a fix, and the
            // family screen already treats it as "no position". A missing
            // position must never stop the alert going out.
            body.put("p_lat", loc != null ? loc.getLatitude()  : 0d);
            body.put("p_lng", loc != null ? loc.getLongitude() : 0d);
            // Matches the English label SOSPage writes for its general alert —
            // sos_alerts.message is read back and translated by label, so a new
            // string here would render as unknown on every other device.
            body.put("p_message", "SOS! I need help!");

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/send_sos");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            if (SosResponse.isOk(code)) {
                String id = SosResponse.parseId(readBody(conn));
                Log.i(TAG, "SOS sent (" + source + ") id=" + id);
                return new Attempt(code, id);
            }
            return new Attempt(code, null);
        } catch (Exception e) {
            Log.e(TAG, "SOS send failed (" + source + "): " + e.getMessage());
            // 0, not an auth code: a timeout or a dead network must not spend
            // the single-use refresh token on a problem it cannot fix.
            return new Attempt(SosResponse.NO_RESPONSE, null);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** The outcome of one RPC attempt; id is non-null only on a successful send. */
    private static final class Attempt {
        final int    code;
        final String id;
        Attempt(int code, String id) { this.code = code; this.id = id; }
    }

    /**
     * Marks an alert resolved — the same thing "I'm Safe" does in the app.
     * Used by the Cancel action on the sent notification, so a gesture fired by
     * accident can be taken back from the lock screen instead of requiring the
     * phone to be unlocked and the app opened.
     *
     * Blocking; call it off the main thread.
     */
    static boolean resolve(Context ctx, String sosId) {
        SharedPreferences prefs =
            ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(LocationForegroundService.KEY_URL, null);
        String supabaseKey = prefs.getString(LocationForegroundService.KEY_KEY, null);
        String session     = prefs.getString(LocationForegroundService.KEY_SESSION, null);
        if (supabaseUrl == null || supabaseKey == null || session == null || sosId == null) {
            Log.w(TAG, "Cannot cancel — missing config, session or id");
            return false;
        }

        int code = postResolve(supabaseUrl, supabaseKey, session, sosId);
        if (SosResponse.next(code, SosResponse.isOk(code), false) == SosResponse.Step.DELIVERED) {
            Log.i(TAG, "SOS cancelled id=" + sosId);
            return true;
        }

        // The token expires on the same clock as the one used to send, so an
        // alert raised just before expiry would leave the user holding a Cancel
        // button that could never work.
        if (SosResponse.next(code, false, false) == SosResponse.Step.REFRESH_AND_RETRY) {
            Log.w(TAG, "Cancel rejected — HTTP " + code + ", renewing the session and retrying once");
            if (LocationForegroundService.refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                String renewed = prefs.getString(LocationForegroundService.KEY_SESSION, null);
                code = postResolve(supabaseUrl, supabaseKey, renewed, sosId);
                if (SosResponse.next(code, SosResponse.isOk(code), true) == SosResponse.Step.DELIVERED) {
                    Log.i(TAG, "SOS cancelled after a native session refresh, id=" + sosId);
                    return true;
                }
            }
        }
        Log.w(TAG, "Cancel rejected — HTTP " + code);
        return false;
    }

    /** One attempt at resolve_sos. Returns the HTTP status, or 0 if it never landed. */
    private static int postResolve(String supabaseUrl, String supabaseKey,
                                   String session, String sosId) {
        if (session == null) return SosResponse.NO_RESPONSE;

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_sos_id", sosId);

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/resolve_sos");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return conn.getResponseCode();
        } catch (Exception e) {
            Log.e(TAG, "Cancel failed: " + e.getMessage());
            return 0;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readBody(HttpURLConnection conn) {
        try (java.io.InputStream in = conn.getInputStream();
             java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
            byte[] buf = new byte[1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
