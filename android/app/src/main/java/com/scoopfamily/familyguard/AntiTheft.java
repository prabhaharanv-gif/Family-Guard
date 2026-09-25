package com.scoopfamily.familyguard;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Wrong-password alert: what happens after the phone reports a failed unlock.
 *
 * The receiver (AntiTheftAdminReceiver) is told about each failed attempt;
 * UnlockAttemptPlan decides when that adds up to a report. This class owns the
 * stored state, the report to the server (report_unlock_attempts) and, if the
 * owner also switched it on, the front-camera photo (IntruderCaptureActivity).
 *
 * Off unless the owner turned it on in Profile → Anti-theft. The report goes to
 * the family ADMINS only; the server enforces who can read the photo.
 *
 * Reuses the session the location service already keeps in SharedPreferences,
 * with the same renew-once-on-401 behaviour as SosSender — the phone is locked
 * and the app is not running when this fires, so there is no WebView to lean on.
 */
final class AntiTheft {

    private static final String TAG = "AntiTheft";

    static final String KEY_ON    = "antitheft_on";
    static final String KEY_PHOTO = "antitheft_photo";
    private static final String KEY_FAILS       = "unlock_failures";
    private static final String KEY_FIRST_FAIL  = "unlock_first_fail_at";
    private static final String KEY_LAST_REPORT = "unlock_last_report_at";

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

    private AntiTheft() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
    }

    static ComponentName adminComponent(Context ctx) {
        return new ComponentName(ctx, AntiTheftAdminReceiver.class);
    }

    static boolean isAdminActive(Context ctx) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isAdminActive(adminComponent(ctx));
        } catch (Exception e) {
            return false;
        }
    }

    /** Gives device-admin status back and switches the feature off. A no-op when not held. */
    static void releaseDeviceAdmin(Context ctx) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm != null && dpm.isAdminActive(adminComponent(ctx))) {
                dpm.removeActiveAdmin(adminComponent(ctx));
                Log.i(TAG, "device admin released");
            }
            if (isEnabled(ctx) || isPhotoEnabled(ctx)) setConfig(ctx, false, false);
        } catch (Exception e) {
            Log.w(TAG, "could not release device admin: " + e.getMessage());
        }
    }

    static boolean isEnabled(Context ctx)      { return prefs(ctx).getBoolean(KEY_ON, false); }
    static boolean isPhotoEnabled(Context ctx) { return prefs(ctx).getBoolean(KEY_PHOTO, false); }

    static boolean cameraGranted(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    static void setConfig(Context ctx, boolean on, boolean photo) {
        prefs(ctx).edit().putBoolean(KEY_ON, on).putBoolean(KEY_PHOTO, on && photo).commit();
        Log.i(TAG, "wrong-password alert " + (on ? "ON" : "OFF") + (on && photo ? " (+photo)" : ""));
    }

    // ── Receiver callbacks ──────────────────────────────────────────────────

    static void onPasswordFailed(Context ctx) {
        if (!isEnabled(ctx)) return;
        SharedPreferences p = prefs(ctx);
        UnlockAttemptPlan.State s = new UnlockAttemptPlan.State(
            p.getInt(KEY_FAILS, 0), p.getLong(KEY_FIRST_FAIL, 0L),
            p.getLong(KEY_LAST_REPORT, Long.MIN_VALUE), false, 0);
        UnlockAttemptPlan.State next = UnlockAttemptPlan.onFailed(s, System.currentTimeMillis());
        p.edit().putInt(KEY_FAILS, next.failures).putLong(KEY_FIRST_FAIL, next.firstFailAtMs)
            .putLong(KEY_LAST_REPORT, next.lastReportAtMs).commit();
        Log.i(TAG, "wrong password #" + next.attempts + (next.report ? " — reporting" : ""));
        if (next.report) {
            final Context app = ctx.getApplicationContext();
            final int attempts = next.attempts;
            EXEC.submit(() -> report(app, attempts));
        }
    }

    static void onPasswordSucceeded(Context ctx) {
        SharedPreferences p = prefs(ctx);
        p.edit().putInt(KEY_FAILS, 0).putLong(KEY_FIRST_FAIL, 0L).commit();
    }

    // ── Reporting ───────────────────────────────────────────────────────────

    private static void report(Context ctx, int attempts) {
        try {
            SharedPreferences p = prefs(ctx);
            double lat = 0, lng = 0;
            if (p.getLong(LocationForegroundService.KEY_LAST_TIME, 0L) > 0L) {
                lat = Double.longBitsToDouble(p.getLong(LocationForegroundService.KEY_LAST_LAT, 0L));
                lng = Double.longBitsToDouble(p.getLong(LocationForegroundService.KEY_LAST_LNG, 0L));
            }
            JSONObject body = new JSONObject();
            body.put("p_attempts", attempts);
            body.put("p_lat", lat);
            body.put("p_lng", lng);
            Reply r = rpc(ctx, "report_unlock_attempts", body);
            if (r == null || !SosResponse.isOk(r.code)) {
                Log.w(TAG, "report not sent — " + (r == null ? "no session" : "HTTP " + r.code));
                return;
            }
            String group = r.body == null ? "" : r.body.replace("\"", "").trim();
            if (group.isEmpty() || "null".equals(group)) {
                Log.i(TAG, "server declined the report (switched off, or one was sent recently)");
                return;
            }
            Log.i(TAG, "reported to family admins, group=" + group);

            if (isPhotoEnabled(ctx) && cameraGranted(ctx)
                    && (Build.VERSION.SDK_INT < 29 || MainActivity.canDrawOverlays(ctx))) {
                Intent i = new Intent(ctx, IntruderCaptureActivity.class)
                    .putExtra(IntruderCaptureActivity.EXTRA_GROUP, group)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                ctx.startActivity(i);
            } else if (isPhotoEnabled(ctx)) {
                Log.w(TAG, "photo skipped — camera permission or display-over-apps is missing");
            }
        } catch (Exception e) {
            Log.w(TAG, "report failed: " + e.getMessage());
        }
    }

    /** Called by the capture activity with the JPEG it took. Off the main thread. */
    static void uploadPhoto(Context ctx, String group, byte[] jpeg) {
        EXEC.submit(() -> {
            try {
                SharedPreferences p = prefs(ctx);
                String uid = p.getString(LocationForegroundService.KEY_USER_ID, null);
                if (uid == null) { Log.w(TAG, "photo not uploaded — no user id"); return; }
                String path = uid + "/" + group + "/photo.jpg";
                Reply up = post(ctx, "/storage/v1/object/unlock-photos/" + path, "image/jpeg", jpeg);
                if (up == null || !SosResponse.isOk(up.code)) {
                    Log.w(TAG, "photo upload failed — " + (up == null ? "no session" : "HTTP " + up.code));
                    return;
                }
                JSONObject body = new JSONObject();
                body.put("p_group", group);
                body.put("p_path", path);
                Reply at = rpc(ctx, "attach_unlock_photo", body);
                Log.i(TAG, "photo uploaded (" + jpeg.length + " bytes), attach HTTP " + (at == null ? "-" : at.code));
            } catch (Exception e) {
                Log.w(TAG, "photo upload failed: " + e.getMessage());
            }
        });
    }

    // ── HTTP, with one session renewal ──────────────────────────────────────

    private static final class Reply {
        final int code; final String body;
        Reply(int code, String body) { this.code = code; this.body = body; }
    }

    private static Reply rpc(Context ctx, String fn, JSONObject body) throws Exception {
        return post(ctx, "/rest/v1/rpc/" + fn, "application/json", body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static Reply post(Context ctx, String path, String contentType, byte[] data) throws Exception {
        SharedPreferences p = prefs(ctx);
        String url = p.getString(LocationForegroundService.KEY_URL, null);
        String key = p.getString(LocationForegroundService.KEY_KEY, null);
        String session = p.getString(LocationForegroundService.KEY_SESSION, null);
        if (url == null || key == null || session == null) return null;

        Reply r = send(url + path, key, session, contentType, data);
        if (r.code == 401 || r.code == 403) {
            if (!LocationForegroundService.refreshAccessToken(p, url, key)) return r;
            r = send(url + path, key, p.getString(LocationForegroundService.KEY_SESSION, null), contentType, data);
        }
        return r;
    }

    private static Reply send(String fullUrl, String key, String session, String contentType, byte[] data) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(fullUrl).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", contentType);
            conn.setRequestProperty("apikey", key);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(20000);
            try (OutputStream os = conn.getOutputStream()) { os.write(data); }
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = "";
            if (in != null) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[1024]; int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                text = bos.toString("UTF-8");
            }
            return new Reply(code, text);
        } catch (Exception e) {
            Log.w(TAG, "request failed: " + e.getMessage());
            return new Reply(SosResponse.NO_RESPONSE, "");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
