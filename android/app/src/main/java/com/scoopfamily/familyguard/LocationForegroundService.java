package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LocationForegroundService — FusedLocationProvider edition
 *
 * Uses Google Play Services' FusedLocationProviderClient instead of raw
 * GPS_PROVIDER. Fused blends GPS satellites + WiFi + cell towers + device
 * sensors and automatically picks the best available source. This is the same
 * engine Google Maps, WhatsApp and Uber use.
 *
 * WHY THE SWITCH: the previous GPS_PROVIDER-only build only produced a fix when
 * satellites were directly visible with <50m accuracy. Indoors, in urban areas,
 * or right after a network change, pure GPS fails and every fix was silently
 * discarded — so location "only updated when moving between networks". Fused
 * works consistently on every network (WiFi, mobile data, indoors, outdoors)
 * because it doesn't depend on a clear sky view.
 *
 * Strategy:
 *   - Priority HIGH_ACCURACY — Fused uses GPS + WiFi + cell as needed
 *   - 15s update interval, accepts down to 5s if a fresh fix is ready
 *   - Accuracy gate: discard fixes worse than 100m (loosened from 50m so
 *     normal indoor WiFi/cell fixes are accepted instead of rejected)
 *   - Distance gate: only push if moved > 15m, EXCEPT a 90s heartbeat keeps
 *     a stationary user's timestamp fresh so their pin stays "live"
 */
public class LocationForegroundService extends Service {

    private static final String TAG         = "FG_Location";
    public  static final String CHANNEL_ID  = "fg_location_v1";
    public  static final int    NOTIF_ID    = 2001;
    public  static boolean      isRunning   = false;

    public static final String PREF_NAME       = "fg_location_prefs";
    public static final String KEY_URL         = "supabase_url";
    public static final String KEY_KEY         = "supabase_key";
    public static final String KEY_USER_ID     = "user_id";
    public static final String KEY_FAMILY_ID   = "family_id";
    public static final String KEY_SESSION     = "session_token";
    public static final String KEY_REFRESH     = "refresh_token";

    // Quality thresholds — must match JS-side filters in useLocationBroadcast.js
    // Loosened to 100m: Fused indoor fixes (WiFi/cell) are often 20-80m, which
    // the old 50m gate rejected — leaving the pin frozen indoors.
    private static final float MAX_ACCURACY_M = 100f;  // discard fixes worse than this
    private static final float MIN_MOVE_M     = 15f;   // only push if moved this far

    // A single bad fix (stale WiFi AP entry, cell-tower fallback, GPS multipath) can
    // report a "plausible" accuracy while being far off, making the pin teleport and
    // then snap back on the next good fix. Anything implying faster than this is held
    // back until a second fix roughly confirms it — real fast travel confirms itself
    // within one interval; a one-off jump never gets a second matching fix.
    private static final float MAX_PLAUSIBLE_SPEED_MPS = 55f;  // ~200 km/h
    private static final float JUMP_CONFIRM_RADIUS_M    = 50f;

    // Push at least this often even when stationary, so the pin stays "live"
    private static final long HEARTBEAT_MS       = 90_000L;   // 90 seconds
    // How often to request a fresh fix from FusedLocationProvider. Lowered from 15s/5s
    // to update a moving user's pin as fast as reasonably possible; the distance/
    // heartbeat gate below still controls how often a push actually happens.
    private static final long UPDATE_INTERVAL_MS = 5_000L;
    private static final long UPDATE_FASTEST_MS  = 3_000L;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback            locationCallback;
    private ExecutorService  executor;
    private Handler          mainHandler;

    // Last successfully pushed location — for distance gate
    private Location lastPushedLocation = null;
    // Timestamp of the last push — used for the stationary heartbeat
    private long lastPushTime = 0L;
    // An implausibly-fast fix awaiting a second fix to confirm it isn't a GPS jump
    private Location pendingJumpLocation = null;

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public void onCreate() {
        super.onCreate();
        executor    = Executors.newSingleThreadExecutor();
        mainHandler = new Handler(Looper.getMainLooper());
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        ensureChannel(this);
        registerLocationToggleReceiver();
    }

    // ── Location services on/off reporting ───────────────────────────────────
    // When the user switches location OFF the device stops producing fixes, so
    // pushLocation() never runs and the server would never learn about it — the
    // pin would just silently go stale and stay green. This receiver reports
    // the change directly instead, with no fix required.
    private android.content.BroadcastReceiver locToggleReceiver = null;
    private Boolean lastReportedLocEnabled = null;

    private void registerLocationToggleReceiver() {
        try {
            locToggleReceiver = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    reportLocationEnabled(isDeviceLocationEnabled());
                }
            };
            registerReceiver(locToggleReceiver,
                new android.content.IntentFilter(android.location.LocationManager.PROVIDERS_CHANGED_ACTION));
            // Report the state once at startup too — the setting may already
            // have been off before the service came up, in which case no
            // broadcast is ever going to arrive.
            reportLocationEnabled(isDeviceLocationEnabled());
        } catch (Exception e) {
            Log.w(TAG, "Could not register location toggle receiver: " + e.getMessage());
        }
    }

    private boolean isDeviceLocationEnabled() {
        try {
            android.location.LocationManager lm =
                (android.location.LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {  // API 28
                return lm.isLocationEnabled();
            }
            return lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            // Unknown — assume on. A false "GPS off" warning would be more
            // alarming to the family than a missing one.
            return true;
        }
    }

    /** POSTs the flag only when it has actually changed, off the main thread. */
    private void reportLocationEnabled(boolean enabled) {
        if (lastReportedLocEnabled != null && lastReportedLocEnabled == enabled) return;
        lastReportedLocEnabled = enabled;

        final SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        final String supabaseUrl = prefs.getString(KEY_URL,       null);
        final String supabaseKey = prefs.getString(KEY_KEY,       null);
        final String familyId    = prefs.getString(KEY_FAMILY_ID, null);
        final String session     = prefs.getString(KEY_SESSION,   null);
        if (supabaseUrl == null || supabaseKey == null || familyId == null) return;

        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_family_id", familyId);
                body.put("p_enabled",   enabled);

                URL url = new URL(supabaseUrl + "/rest/v1/rpc/set_location_status");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("apikey",        supabaseKey);
                conn.setRequestProperty("Authorization",
                    "Bearer " + (session != null ? session : supabaseKey));
                conn.setDoOutput(true);
                conn.setConnectTimeout(8_000);
                conn.setReadTimeout(8_000);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes("UTF-8"));
                }
                Log.i(TAG, "location_enabled=" + enabled + " -> HTTP " + conn.getResponseCode());
                conn.disconnect();
            } catch (Exception e) {
                // Reset so the next broadcast or restart retries rather than
                // assuming the server already knows.
                lastReportedLocEnabled = null;
                Log.w(TAG, "set_location_status failed — " + e.getMessage());
            }
        }, "loc-status").start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        // Android 14+ (API 34+) REQUIRES the service type to be passed explicitly
        // to startForeground() for a "location" typed service. The old
        // 2-argument startForeground() throws and the service dies instantly.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {  // API 34
            startForeground(
                NOTIF_ID,
                buildNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(NOTIF_ID, buildNotification());
        }
        startLocationUpdates();
        Log.i(TAG, "Location foreground service started — FusedLocationProvider");
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        try {
            if (fusedClient != null && locationCallback != null) {
                fusedClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception e) { /* ignore */ }
        try {
            if (locToggleReceiver != null) {
                unregisterReceiver(locToggleReceiver);
                locToggleReceiver = null;
            }
        } catch (Exception e) { /* ignore */ }
        if (executor != null) executor.shutdownNow();
        Log.i(TAG, "Location foreground service stopped");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    /**
     * Called when the user swipes the app away from Recents. By default Android
     * kills the whole process including this service. We schedule an immediate
     * restart via AlarmManager so background location tracking survives the app
     * being swiped away — essential for a family-safety app.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "App swiped from recents — scheduling service restart");

        // Presence backstop. The JS appStateChange listener in useHeartbeat.js
        // normally marks the member offline on pause, but a swipe-away tears the
        // WebView down and that call can be lost in flight. This service keeps
        // running (stopWithTask="false" + the restart alarm below), so it can
        // still reach the network — without it a swiped-away member stayed
        // Online until their heartbeat aged out.
        markOfflineAsync();

        Intent restartIntent = new Intent(getApplicationContext(), LocationForegroundService.class);
        restartIntent.setPackage(getPackageName());

        PendingIntent restartPending = PendingIntent.getService(
            getApplicationContext(), 1, restartIntent,
            PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.AlarmManager alarm =
            (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) {
            alarm.set(
                android.app.AlarmManager.ELAPSED_REALTIME,
                android.os.SystemClock.elapsedRealtime() + 1000,  // restart in 1s
                restartPending
            );
        }
        super.onTaskRemoved(rootIntent);
    }

    /**
     * Best-effort "I am no longer in the app" POST, off the main thread.
     *
     * Fire-and-forget by design: onTaskRemoved() must return promptly, and a
     * missed call is not harmful — the client also requires a fresh heartbeat
     * to show a member Online, so an unsent offline signal only delays the
     * transition by the staleness window instead of losing it.
     */
    private void markOfflineAsync() {
        final SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        final String supabaseUrl = prefs.getString(KEY_URL,       null);
        final String supabaseKey = prefs.getString(KEY_KEY,       null);
        final String familyId    = prefs.getString(KEY_FAMILY_ID, null);
        final String session     = prefs.getString(KEY_SESSION,   null);

        if (supabaseUrl == null || supabaseKey == null || familyId == null) return;

        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_family_id", familyId);

                URL url = new URL(supabaseUrl + "/rest/v1/rpc/set_member_offline");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("apikey",        supabaseKey);
                conn.setRequestProperty("Authorization",
                    "Bearer " + (session != null ? session : supabaseKey));
                conn.setDoOutput(true);
                conn.setConnectTimeout(5_000);
                conn.setReadTimeout(5_000);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes("UTF-8"));
                }

                int code = conn.getResponseCode();
                Log.i(TAG, "presence: set_member_offline -> HTTP " + code);
                conn.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "presence: set_member_offline failed — " + e.getMessage());
            }
        }, "presence-offline").start();
    }

    // ── Location setup ────────────────────────────────────────────────────────
    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(UPDATE_FASTEST_MS)
            // minUpdateDistance 0 — deliver updates on the time interval even when
            // stationary, so the heartbeat can keep the timestamp fresh. We apply
            // the movement filter ourselves in handleLocation().
            .setMinUpdateDistanceMeters(0f)
            .setWaitForAccurateLocation(false)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) handleLocation(loc, "FUSED");
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());

            // Prime with the last known location immediately so the pin appears
            // right away instead of waiting for the first interval tick.
            fusedClient.getLastLocation().addOnSuccessListener(loc -> {
                if (loc != null) handleLocation(loc, "LAST_KNOWN");
            });
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing: " + e.getMessage());
            stopSelf();
        }
    }

    // ── Quality gate + push ───────────────────────────────────────────────────
    private void handleLocation(Location loc, String source) {
        if (loc == null) return;

        float accuracy = loc.getAccuracy();

        // Accuracy gate — discard poor fixes
        if (accuracy > MAX_ACCURACY_M) {
            Log.d(TAG, source + " fix discarded — accuracy " + accuracy + "m > " + MAX_ACCURACY_M + "m");
            return;
        }

        // Jump gate — reject a fix that implies unrealistic speed from the last
        // pushed position unless a second fix roughly confirms it. This catches
        // the "pin teleports far away then snaps back" pattern without ever
        // pushing the bad fix in the first place.
        if (lastPushedLocation != null) {
            float jumpDist  = lastPushedLocation.distanceTo(loc);
            long  elapsedMs = System.currentTimeMillis() - lastPushTime;
            // Clamp the elapsed time used for the speed check. Without this, a stale
            // baseline (e.g. a 90s stationary heartbeat gap) makes a multi-km jump look
            // like a "plausible" low speed — 5km in 90s is only ~200km/h — even though
            // the person hasn't actually moved. Real movement pushes far more often than
            // once per heartbeat (see the distance gate below), so clamping to a short
            // window doesn't affect genuine fast travel, only stale-baseline jumps.
            long  speedElapsedMs = Math.min(elapsedMs, 20_000L);
            float impliedMps = speedElapsedMs > 0 ? jumpDist / (speedElapsedMs / 1000f) : 0f;

            if (impliedMps > MAX_PLAUSIBLE_SPEED_MPS) {
                if (pendingJumpLocation != null && pendingJumpLocation.distanceTo(loc) <= JUMP_CONFIRM_RADIUS_M) {
                    Log.i(TAG, source + " jump confirmed by second fix (" + jumpDist + "m, "
                        + (impliedMps * 3.6f) + " km/h implied) — accepting");
                    pendingJumpLocation = null;
                } else {
                    Log.w(TAG, source + " fix rejected as GPS jump — " + jumpDist + "m in " + elapsedMs
                        + "ms (" + (impliedMps * 3.6f) + " km/h implied) — awaiting confirmation");
                    pendingJumpLocation = loc;
                    return;
                }
            } else {
                pendingJumpLocation = null;
            }
        }

        // Distance gate — only push if moved MIN_MOVE_M from last push, OR if
        // HEARTBEAT_MS elapsed (so a stationary user's timestamp still refreshes
        // and their pin stays "live" instead of going stale).
        if (lastPushedLocation != null) {
            float moved = lastPushedLocation.distanceTo(loc);
            long sinceLastPush = System.currentTimeMillis() - lastPushTime;
            if (moved < MIN_MOVE_M && sinceLastPush < HEARTBEAT_MS) {
                Log.d(TAG, source + " fix skipped — moved " + moved + "m, heartbeat in "
                    + ((HEARTBEAT_MS - sinceLastPush) / 1000) + "s");
                return;
            }
            if (moved < MIN_MOVE_M) {
                Log.i(TAG, source + " heartbeat push — stationary, refreshing timestamp");
            }
        }

        Log.i(TAG, "✅ " + source + " fix accepted — accuracy=" + accuracy + "m | moved=" +
            (lastPushedLocation != null ? lastPushedLocation.distanceTo(loc) + "m" : "first fix"));

        lastPushedLocation = loc;
        lastPushTime = System.currentTimeMillis();
        executor.submit(() -> pushLocation(loc));
    }

    // ── Push to Supabase ──────────────────────────────────────────────────────
    private void pushLocation(Location loc) {
        android.content.SharedPreferences prefs =
            getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);

        String supabaseUrl = prefs.getString(KEY_URL,       null);
        String supabaseKey = prefs.getString(KEY_KEY,       null);
        String userId      = prefs.getString(KEY_USER_ID,   null);
        String familyId    = prefs.getString(KEY_FAMILY_ID, null);

        if (supabaseUrl == null || supabaseKey == null || userId == null || familyId == null) {
            Log.w(TAG, "Missing credentials — stopping service");
            stopSelf();
            return;
        }

        // Battery
        android.content.Intent batteryIntent = registerReceiver(null,
            new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
        int battery  = -1;
        boolean charging = false;
        if (batteryIntent != null) {
            int level  = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
            int scale  = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
            int status = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
            if (level >= 0 && scale > 0) battery = (int)((level / (float) scale) * 100);
            charging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                    || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
        }

        float speedKmh = loc.hasSpeed() ? loc.getSpeed() * 3.6f : 0f;

        int code = doPush(prefs, supabaseUrl, supabaseKey, familyId, loc, battery, charging, speedKmh);

        // The session access token expires ~1 hour after login. JS-side refreshes it
        // every 30 min via updateSessionToken(), but that requires the app to be alive
        // — WebView timers freeze once the app is backgrounded/closed. Without a native
        // fallback, every push after expiry would 401 forever and the pin would freeze
        // at whatever position was last captured while the app was open. Instead, refresh
        // the session natively using the stored Supabase refresh token and retry once.
        if (code == 401 || code == 403) {
            Log.w(TAG, "⚠️ Push rejected (" + code + ") — attempting native session refresh");
            if (refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                code = doPush(prefs, supabaseUrl, supabaseKey, familyId, loc, battery, charging, speedKmh);
                if (code == 200 || code == 204) {
                    Log.i(TAG, "✅ Push succeeded after native session refresh");
                } else {
                    Log.w(TAG, "❌ Push still failing after refresh — HTTP " + code);
                }
            } else {
                Log.w(TAG, "❌ Could not refresh session natively — refresh token missing/expired, user must reopen the app to re-authenticate");
            }
        }

        // The RPC can fail for reasons unrelated to auth (e.g. a server-side bug in
        // upsert_location_with_battery). The JS path (useLocationBroadcast.js) already
        // falls back to a direct table upsert when the RPC throws, which is why tracking
        // keeps working while the app is open. The native path had no equivalent fallback,
        // so any non-auth RPC failure froze the pin the moment the app was closed. Mirror
        // the JS fallback here so background tracking doesn't depend on the RPC working.
        if (code != 200 && code != 204) {
            Log.w(TAG, "⚠️ RPC push failed (HTTP " + code + ") — falling back to direct table upsert");
            if (doDirectUpsert(prefs, supabaseUrl, supabaseKey, userId, familyId, loc, speedKmh)) {
                Log.i(TAG, "✅ Fallback direct upsert succeeded");
            } else {
                Log.w(TAG, "❌ Fallback direct upsert also failed");
            }
        }
    }

    // Direct PostgREST upsert into the locations table, bypassing the RPC entirely.
    // Mirrors the fallback in useLocationBroadcast.js so native background tracking
    // survives a broken/misbehaving RPC function the same way the foreground JS path does.
    private boolean doDirectUpsert(SharedPreferences prefs, String supabaseUrl, String supabaseKey,
                                    String userId, String familyId, Location loc, float speedKmh) {
        try {
            JSONObject body = new JSONObject();
            body.put("user_id",    userId);
            body.put("family_id",  familyId);
            body.put("lat",        loc.getLatitude());
            body.put("lng",        loc.getLongitude());
            body.put("accuracy",   loc.getAccuracy());
            body.put("speed",      speedKmh);
            body.put("is_sharing", true);
            java.text.SimpleDateFormat sdf =
                new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            body.put("updated_at", sdf.format(new java.util.Date()));

            String sessionToken = prefs.getString(KEY_SESSION, null);
            String authHeader   = sessionToken != null
                ? "Bearer " + sessionToken
                : "Bearer " + supabaseKey;

            URL url = new URL(supabaseUrl + "/rest/v1/locations?on_conflict=user_id,family_id");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey",        supabaseKey);
            conn.setRequestProperty("Authorization", authHeader);
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }

            int code = conn.getResponseCode();
            if (code != 200 && code != 201 && code != 204) {
                java.io.InputStream errStream = conn.getErrorStream();
                String errBody = "";
                if (errStream != null) {
                    try (java.io.BufferedReader br = new java.io.BufferedReader(
                            new java.io.InputStreamReader(errStream))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        errBody = sb.toString();
                    } catch (Exception ignored) {}
                }
                Log.w(TAG, "Direct upsert failed HTTP " + code + " — " + errBody);
            }
            conn.disconnect();
            return code == 200 || code == 201 || code == 204;
        } catch (Exception e) {
            Log.e(TAG, "Direct upsert error: " + e.getMessage());
            return false;
        }
    }

    // Performs one HTTP push attempt. Returns the response code (or -1 on exception).
    private int doPush(SharedPreferences prefs, String supabaseUrl, String supabaseKey,
                        String familyId, Location loc, int battery, boolean charging, float speedKmh) {
        try {
            JSONObject body = new JSONObject();
            body.put("p_family_id", familyId);
            body.put("p_lat",       loc.getLatitude());
            body.put("p_lng",       loc.getLongitude());
            body.put("p_accuracy",  loc.getAccuracy());
            body.put("p_speed",     speedKmh);
            if (battery >= 0) {
                body.put("p_battery",     battery);
                body.put("p_is_charging", charging);
            }

            String sessionToken = prefs.getString(KEY_SESSION, null);
            String authHeader   = sessionToken != null
                ? "Bearer " + sessionToken
                : "Bearer " + supabaseKey;

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/upsert_location_with_battery");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey",        supabaseKey);
            conn.setRequestProperty("Authorization", authHeader);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }

            int code = conn.getResponseCode();
            if (code == 200 || code == 204) {
                Log.i(TAG, "✅ Pushed: " + loc.getLatitude() + "," + loc.getLongitude()
                    + " acc=" + loc.getAccuracy() + "m bat=" + battery + "%");
            } else {
                java.io.InputStream errStream = conn.getErrorStream();
                String errBody = "";
                if (errStream != null) {
                    try (java.io.BufferedReader br = new java.io.BufferedReader(
                            new java.io.InputStreamReader(errStream))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        errBody = sb.toString();
                    } catch (Exception ignored) {}
                }
                Log.w(TAG, "❌ Push failed HTTP " + code + " — " + errBody);
            }
            conn.disconnect();
            return code;

        } catch (Exception e) {
            Log.e(TAG, "Push error: " + e.getMessage());
            return -1;
        }
    }

    // Uses the stored Supabase refresh token to mint a fresh access token, entirely
    // natively — no JS/WebView involved, so this works even with the app fully closed.
    // Supabase rotates the refresh token on each use, so the new one must be persisted too.
    private boolean refreshAccessToken(SharedPreferences prefs, String supabaseUrl, String supabaseKey) {
        String refreshToken = prefs.getString(KEY_REFRESH, null);
        if (refreshToken == null) {
            Log.w(TAG, "No refresh token stored — cannot renew session natively");
            return false;
        }

        try {
            JSONObject body = new JSONObject();
            body.put("refresh_token", refreshToken);

            URL url = new URL(supabaseUrl + "/auth/v1/token?grant_type=refresh_token");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", supabaseKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "Token refresh failed HTTP " + code + " — refresh token likely expired, needs re-login");
                conn.disconnect();
                return false;
            }

            StringBuilder sb = new StringBuilder();
            try (java.io.BufferedReader br = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
            conn.disconnect();

            JSONObject json = new JSONObject(sb.toString());
            String newAccessToken  = json.optString("access_token", null);
            String newRefreshToken = json.optString("refresh_token", null);
            if (newAccessToken == null) {
                Log.w(TAG, "Token refresh response missing access_token");
                return false;
            }

            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_SESSION, newAccessToken);
            if (newRefreshToken != null) editor.putString(KEY_REFRESH, newRefreshToken);
            editor.apply();

            Log.i(TAG, "✅ Session refreshed natively — background tracking keeps flowing");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Token refresh error: " + e.getMessage());
            return false;
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────
    private Notification buildNotification() {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("🛡️ Famora")
            .setContentText("Protecting your family · location active")
            .setSubText("Tap to open")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pi)
            .build();
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Location Tracking", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows while Famora is tracking your location");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    public static void startService(Context ctx) {
        ensureChannel(ctx);
        Intent intent = new Intent(ctx, LocationForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    public static void stopService(Context ctx) {
        ctx.stopService(new Intent(ctx, LocationForegroundService.class));
        isRunning = false;
    }
}
