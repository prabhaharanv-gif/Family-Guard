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
            if (code == 200 || code == 201 || code == 204) {
                // send_sos RETURNS uuid, which PostgREST hands back as a bare
                // JSON scalar — a quoted string, not an object.
                String id = readBody(conn).trim();
                if (id.startsWith("\"") && id.endsWith("\"") && id.length() > 2) {
                    id = id.substring(1, id.length() - 1);
                }
                Log.i(TAG, "SOS sent (" + source + ") id=" + id);
                return id.isEmpty() ? null : id;
            }
            Log.w(TAG, "SOS rejected (" + source + ") — HTTP " + code);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "SOS send failed (" + source + "): " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
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
            int code = conn.getResponseCode();
            boolean ok = code == 200 || code == 201 || code == 204;
            Log.i(TAG, ok ? "SOS cancelled id=" + sosId : "Cancel rejected — HTTP " + code);
            return ok;
        } catch (Exception e) {
            Log.e(TAG, "Cancel failed: " + e.getMessage());
            return false;
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
