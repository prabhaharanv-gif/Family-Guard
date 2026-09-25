package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Raw REST calls for the "Famora Social" nearby-help RPCs — accept_nearby_help,
 * decline_nearby_help, get_nearby_help_location.
 *
 * Reached from NearbyHelpActionReceiver, a BroadcastReceiver fired from a
 * notification action: like SosCancelReceiver, there is no live WebView to
 * call supabase-js through, since whatever woke this may be all that is
 * running. Sibling of SosSender in every way that matters, and reuses the
 * exact same stored session — url, anon key, access token — that
 * LocationForegroundService already keeps in SharedPreferences for its own
 * pushes. No new state, no new permissions.
 *
 * Same refresh-and-retry-once shape as SosSender, for the same reason: the
 * access token expires about an hour after login, and a bystander tapping a
 * ring notification is just as likely to be doing so against a stale token as
 * the SOS gesture is. See SosSender's class doc for the fuller explanation of
 * why this refreshes natively rather than deferring to the WebView.
 */
final class NearbyHelpSender {

    private static final String TAG = "FamoraNearbyHelp";

    private NearbyHelpSender() {}

    /** Calls accept_nearby_help. Blocking — call off the main thread. */
    static boolean accept(Context ctx, String notificationId) {
        return callVoidRpc(ctx, "accept_nearby_help", "p_notification_id", notificationId);
    }

    /** Calls decline_nearby_help. Blocking — call off the main thread. */
    static boolean decline(Context ctx, String notificationId) {
        return callVoidRpc(ctx, "decline_nearby_help", "p_notification_id", notificationId);
    }

    /**
     * Calls get_nearby_help_location. Returns {lat, lng}, or null if the RPC
     * failed or returned zero rows — the reveal-authorization check inside
     * the function itself, not an error condition. Blocking — call off the
     * main thread.
     */
    static double[] getLocation(Context ctx, String escalationId) {
        SharedPreferences prefs = prefs(ctx);
        String supabaseUrl = prefs.getString(LocationForegroundService.KEY_URL, null);
        String supabaseKey = prefs.getString(LocationForegroundService.KEY_KEY, null);
        String session      = prefs.getString(LocationForegroundService.KEY_SESSION, null);
        if (supabaseUrl == null || supabaseKey == null || escalationId == null) {
            Log.w(TAG, "Cannot reveal location — missing config or escalation id");
            return null;
        }

        Attempt a = postRpc(supabaseUrl, supabaseKey, session,
            "get_nearby_help_location", "p_escalation_id", escalationId);
        switch (NearbyHelpResponse.next(a.code, a.body != null, false)) {
            case DELIVERED:
                return NearbyHelpResponse.parseLocation(a.body);

            case REFRESH_AND_RETRY:
                Log.w(TAG, "get_nearby_help_location rejected — HTTP " + a.code
                         + ", renewing the session and retrying once");
                if (!LocationForegroundService.refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                    Log.w(TAG, "Could not renew the session for get_nearby_help_location");
                    return null;
                }
                String renewed = prefs.getString(LocationForegroundService.KEY_SESSION, null);
                a = postRpc(supabaseUrl, supabaseKey, renewed,
                    "get_nearby_help_location", "p_escalation_id", escalationId);
                if (NearbyHelpResponse.next(a.code, a.body != null, true) == NearbyHelpResponse.Step.DELIVERED) {
                    return NearbyHelpResponse.parseLocation(a.body);
                }
                return null;

            default:
                // Zero rows (not the accepted helper) looks identical to a
                // real failure from here — both are a non-2xx/empty body. The
                // caller shows a generic fallback either way.
                return null;
        }
    }

    private static boolean callVoidRpc(Context ctx, String function, String paramName, String paramValue) {
        SharedPreferences prefs = prefs(ctx);
        String supabaseUrl = prefs.getString(LocationForegroundService.KEY_URL, null);
        String supabaseKey = prefs.getString(LocationForegroundService.KEY_KEY, null);
        String session      = prefs.getString(LocationForegroundService.KEY_SESSION, null);
        if (supabaseUrl == null || supabaseKey == null || paramValue == null) {
            Log.w(TAG, "Cannot call " + function + " — missing config or id");
            return false;
        }

        Attempt a = postRpc(supabaseUrl, supabaseKey, session, function, paramName, paramValue);
        switch (NearbyHelpResponse.next(a.code, NearbyHelpResponse.isOk(a.code), false)) {
            case DELIVERED:
                Log.i(TAG, function + " ok");
                return true;

            case REFRESH_AND_RETRY:
                Log.w(TAG, function + " rejected — HTTP " + a.code + ", renewing the session and retrying once");
                if (!LocationForegroundService.refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                    Log.w(TAG, "Could not renew the session — the user must reopen the app");
                    return false;
                }
                String renewed = prefs.getString(LocationForegroundService.KEY_SESSION, null);
                a = postRpc(supabaseUrl, supabaseKey, renewed, function, paramName, paramValue);
                boolean ok = NearbyHelpResponse.next(a.code, NearbyHelpResponse.isOk(a.code), true)
                    == NearbyHelpResponse.Step.DELIVERED;
                if (!ok) Log.w(TAG, function + " still rejected after the refresh — HTTP " + a.code);
                return ok;

            default:
                // Not an auth problem — either a genuine failure, or the
                // RPC's own "already handled" error (accept_nearby_help
                // raises once the escalation is no longer 'searching').
                // Nothing here can tell the two apart, and nothing more to
                // retry either way; the caller shows a generic fallback.
                if (a.code != NearbyHelpResponse.NO_RESPONSE) {
                    Log.w(TAG, function + " rejected — HTTP " + a.code);
                }
                return false;
        }
    }

    private static Attempt postRpc(String supabaseUrl, String supabaseKey, String session,
                                    String function, String paramName, String paramValue) {
        if (session == null) return new Attempt(NearbyHelpResponse.NO_RESPONSE, null);

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put(paramName, paramValue);

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/" + function);
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
            if (NearbyHelpResponse.isOk(code)) {
                return new Attempt(code, readBody(conn));
            }
            return new Attempt(code, null);
        } catch (Exception e) {
            Log.e(TAG, function + " failed: " + e.getMessage());
            return new Attempt(NearbyHelpResponse.NO_RESPONSE, null);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
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

    /** The outcome of one RPC attempt; body is non-null only on a 2xx reply. */
    private static final class Attempt {
        final int    code;
        final String body;
        Attempt(int code, String body) { this.code = code; this.body = body; }
    }
}
