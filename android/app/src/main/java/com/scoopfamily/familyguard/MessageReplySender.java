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
 * Sends a reply typed into a message notification, with the app closed.
 *
 * Same approach as SosSender: the RPC the app itself uses (send_message,
 * send_direct_message) over plain HTTP, with the session the location service
 * already keeps in SharedPreferences. No new state and no new permission.
 *
 * Stale tokens: the access token lasts about an hour, so a 401 or 403 renews
 * the session through TokenBroker and retries once, and only once. The rules
 * for which rejections earn that retry live in SosResponse, shared with the
 * SOS sender so the two cannot disagree. Nothing else is retried: a refresh
 * token is single-use, and spending one on a dead network would sign the
 * member out.
 */
final class MessageReplySender {

    private static final String TAG = "MsgReply";

    private MessageReplySender() {}

    /**
     * Blocking, so call it off the main thread.
     *
     * @param recipientId the person being answered, for a private message; null for the family chat.
     */
    static ReplyPlan.Outcome send(Context ctx, String familyId, boolean direct,
                                  String recipientId, String text) {
        SharedPreferences prefs =
            ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        String url     = prefs.getString(LocationForegroundService.KEY_URL, null);
        String key     = prefs.getString(LocationForegroundService.KEY_KEY, null);
        String session = prefs.getString(LocationForegroundService.KEY_SESSION, null);

        if (url == null || key == null) {
            Log.w(TAG, "Cannot reply: no Supabase config stored yet");
            return ReplyPlan.Outcome.FAILED;
        }
        if (session == null) {
            Log.w(TAG, "Cannot reply: no session token, the member is signed out");
            return ReplyPlan.Outcome.FAILED;
        }

        int code = post(url, key, session, familyId, direct, recipientId, text);
        switch (SosResponse.next(code, SosResponse.isOk(code), false)) {
            case DELIVERED:
                return ReplyPlan.Outcome.SENT;

            case REFRESH_AND_RETRY:
                Log.w(TAG, "Reply rejected (HTTP " + code + "), renewing the session and retrying once");
                if (!LocationForegroundService.refreshAccessToken(prefs, url, key)) {
                    Log.w(TAG, "Could not renew the session; the member must reopen the app");
                    return ReplyPlan.Outcome.FAILED;
                }
                code = post(url, key, prefs.getString(LocationForegroundService.KEY_SESSION, null),
                            familyId, direct, recipientId, text);
                return SosResponse.isOk(code) ? ReplyPlan.Outcome.SENT : ReplyPlan.Outcome.FAILED;

            default:
                if (code != SosResponse.NO_RESPONSE) Log.w(TAG, "Reply rejected: HTTP " + code);
                return ReplyPlan.Outcome.FAILED;
        }
    }

    /** One attempt. Returns the HTTP status, or NO_RESPONSE if the request threw. */
    private static int post(String url, String key, String session, String familyId,
                            boolean direct, String recipientId, String text) {
        if (session == null) return SosResponse.NO_RESPONSE;
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_family_id", familyId);
            if (direct) body.put("p_recipient_id", recipientId);
            body.put("p_content", text);

            conn = (HttpURLConnection) new URL(url + "/rest/v1/rpc/" + ReplyPlan.rpcFor(direct)).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", key);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return conn.getResponseCode();
        } catch (Exception e) {
            Log.w(TAG, "Reply request failed: " + e.getMessage());
            return SosResponse.NO_RESPONSE;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
