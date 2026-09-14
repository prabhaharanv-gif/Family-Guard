package com.scoopfamily.familyguard;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

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

    // How many consecutive 401s to leave to the WebView before renewing anyway.
    // At a ~95s heartbeat this is a little over three minutes of deferring.
    private static final int MAX_DEFERRED_AUTH_RETRIES = 2;
    private static int deferredAuthRetries = 0;

    // The quality thresholds and the rules that use them now live in
    // LocationFilter, which is plain Java and unit tested (LocationFilterTest).
    // They must still match the JS-side filters in useLocationBroadcast.js.
    // The geometry stays here: distances are measured with Location#distanceTo
    // and handed to the filter, so nothing about how far apart two fixes are
    // has changed.
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

    // The same fix, reachable without a handle on the service instance, so the
    // power-button gesture can attach a position to an SOS raised while the app
    // is closed. Kept deliberately separate from lastPushedLocation rather than
    // made static: that field is instance state the push logic mutates, and an
    // SOS only ever reads.
    private static volatile Location lastKnownForSos = null;

    /** Most recent accepted fix, or null before the first one. */
    static Location getLastKnownLocation() { return lastKnownForSos; }

    // Two volume presses one way then two the other; see VolumeSosGesture.
    // Re-enabled 2026-09-11 to test whether a silent audio keepalive makes MIUI
    // deliver volume keys with the screen off. (powerReceiver further down is
    // unrelated: it is about the charger.)
    private VolumeSosGesture sosGesture;
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
        registerPowerReceiver();
        registerSosGestureReceiver();
    }

    // ── Location services on/off reporting ───────────────────────────────────
    // When the user switches location OFF the device stops producing fixes, so
    // pushLocation() never runs and the server would never learn about it — the
    // pin would just silently go stale and stay green. This receiver reports
    // the change directly instead, with no fix required.
    private android.content.BroadcastReceiver locToggleReceiver = null;
    private android.content.BroadcastReceiver powerReceiver = null;
    private Boolean lastReportedLocEnabled = null;

    /**
     * Push immediately when the charger goes in or out.
     *
     * Battery and charging only reach the database as part of a location write,
     * so between writes the stored charging flag is simply stale. Unplug and
     * walk away and the app keeps showing the charging bolt until the next
     * write happens — which, if the phone is idle or offline, can be minutes.
     * Verified: the reading itself is correct within 20s ("native reports
     * charging=false" right after an unplug), so the gap was never detection,
     * only how long the old value sat in the database.
     *
     * ACTION_POWER_CONNECTED / _DISCONNECTED fire the moment the state changes,
     * so we reuse the last known fix to push the new charging state at once.
     */
    private void registerPowerReceiver() {
        try {
            powerReceiver = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    final Location loc = lastPushedLocation;
                    if (loc == null || executor == null || executor.isShutdown()) return;
                    Log.i(TAG, "Power state changed (" + intent.getAction() + ") — pushing now");
                    executor.submit(() -> pushLocation(loc));
                }
            };
            android.content.IntentFilter f = new android.content.IntentFilter();
            f.addAction(Intent.ACTION_POWER_CONNECTED);
            f.addAction(Intent.ACTION_POWER_DISCONNECTED);
            registerReceiver(powerReceiver, f);
        } catch (Exception e) {
            Log.w(TAG, "Could not register power receiver: " + e.getMessage());
        }
    }

    /**
     * Two volume presses one way then two the other raise an SOS with the app
     * closed — see VolumeSosGesture, which also carries the history of what was
     * tried before and why.
     *
     * It lives here because this service is the only thing guaranteed to be
     * alive while the app is closed, which is also why the gesture stops working
     * if location sharing is switched off.
     *
     * Note that starting this also starts a silent audio keepalive and takes
     * ownership of the phone's volume keys. If the gesture is withdrawn again,
     * stop registering it here rather than leaving that running.
     */
    private void registerSosGestureReceiver() {
        try {
            sosGesture = new VolumeSosGesture(this);
            sosGesture.start();
        } catch (Exception e) {
            Log.w(TAG, "Could not start the SOS volume gesture: " + e.getMessage());
        }
    }

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

    /**
     * POSTs the flag only when it has actually changed, off the main thread.
     *
     * The memo below is why this has to check what came back. Setting
     * lastReportedLocEnabled before the request means a failure that goes
     * unnoticed is never retried: the flag looks reported, and the family keeps
     * seeing the old sharing state indefinitely. Showing someone as sharing
     * when they are not is false assurance, which is worse than showing
     * nothing, so any outcome that is not a success clears the memo again.
     */
    private void reportLocationEnabled(boolean enabled) {
        if (lastReportedLocEnabled != null && lastReportedLocEnabled == enabled) return;
        lastReportedLocEnabled = enabled;

        final SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        final String supabaseUrl = prefs.getString(KEY_URL,       null);
        final String supabaseKey = prefs.getString(KEY_KEY,       null);
        final String familyId    = prefs.getString(KEY_FAMILY_ID, null);
        final String session     = prefs.getString(KEY_SESSION,   null);
        if (supabaseUrl == null || supabaseKey == null || familyId == null) return;

        if (session == null) {
            // set_location_status is SECURITY DEFINER and starts with
            // `if auth.uid() is null then return`, so the anon key cannot carry
            // this: it is either refused outright or accepted and ignored.
            // Clearing the memo leaves it to be sent once there is a session.
            Log.w(TAG, "set_location_status skipped — no session token yet");
            lastReportedLocEnabled = null;
            return;
        }

        new Thread(() -> {
            boolean delivered = false;
            try {
                int code = postLocationStatus(supabaseUrl, supabaseKey, familyId, session, enabled);

                // Same stale-token story as the SOS path: the WebView cannot
                // refresh while the app is closed, so a background report can
                // be rejected through no fault of its own.
                if (SosResponse.isAuthFailure(code)) {
                    Log.w(TAG, "set_location_status rejected (HTTP " + code
                             + ") — renewing the session and retrying once");
                    if (refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                        String renewed = prefs.getString(KEY_SESSION, null);
                        code = postLocationStatus(supabaseUrl, supabaseKey, familyId, renewed, enabled);
                    }
                }

                delivered = SosResponse.isOk(code);
                Log.i(TAG, "location_enabled=" + enabled + " -> HTTP " + code);
            } catch (Exception e) {
                Log.w(TAG, "set_location_status failed — " + e.getMessage());
            }

            if (!delivered) {
                // Reset so the next broadcast or restart retries rather than
                // assuming the server already knows.
                lastReportedLocEnabled = null;
            }
        }, "loc-status").start();
    }

    /** One attempt at set_location_status. Returns the status, or 0 if it never landed. */
    private int postLocationStatus(String supabaseUrl, String supabaseKey, String familyId,
                                   String session, boolean enabled) {
        if (session == null) return SosResponse.NO_RESPONSE;

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_family_id", familyId);
            body.put("p_enabled",   enabled);

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/set_location_status");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey",        supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            return conn.getResponseCode();
        } catch (Exception e) {
            Log.w(TAG, "set_location_status failed — " + e.getMessage());
            return SosResponse.NO_RESPONSE;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A "location" typed foreground service is only legal while the app
        // actually holds the location runtime permission. On Android 14+ the
        // system enforces that inside startForeground() by throwing
        // SecurityException, which is an uncaught crash on the main thread —
        // it takes the whole PROCESS down, not just the service.
        //
        // On a fresh install the permission has not been granted yet, so the
        // app killed itself moments after launch and dropped the user back at
        // the launcher: it looked like the app simply would not open, or
        // "minimised itself" (seen on an Android 15 Motorola; never on the
        // Android 12 test phone, where this is not enforced at all).
        //
        // startService() above refuses to start us in that state, so reaching
        // here without the permission means something bypassed it. We are
        // already committed: skipping startForeground() entirely earns a
        // ForegroundServiceDidNotStartInTimeException, which is equally fatal.
        // Post the notification untyped to satisfy the contract, then stop.
        if (!hasLocationPermission(this)) {
            Log.w(TAG, "No location permission — satisfying FGS contract, then stopping");
            try {
                // The typed overload and TYPE_NONE are both API 29+; below
                // that nothing enforces service types, so the plain call is
                // both sufficient and the only one available.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIF_ID,
                        buildNotification(),
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE
                    );
                } else {
                    startForeground(NOTIF_ID, buildNotification());
                }
            } catch (Exception e) {
                Log.w(TAG, "untyped startForeground refused — " + e.getMessage());
            }
            isRunning = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        isRunning = true;
        try {
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
        } catch (Exception e) {
            // Holding the permission is necessary but not sufficient: the
            // system also refuses a foreground start made from the background
            // unless the app is in an eligible state, which is exactly what
            // the BootReceiver path is. Crashing there would kill the app
            // silently on every reboot, so treat any refusal as "not now".
            Log.w(TAG, "startForeground refused — " + e.getMessage());
            isRunning = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        startLocationUpdates();
        Log.i(TAG, "Location foreground service started — FusedLocationProvider");
        return START_STICKY;
    }

    /**
     * Fine or coarse is enough for a "location" typed foreground service —
     * the system checks anyOf(FINE, COARSE), and the app degrades to coarse
     * fixes rather than refusing to track at all.
     *
     * Public and static because the decision belongs at the START sites, not
     * here: once startForegroundService() has been called the service is
     * committed either way — calling startForeground() with the location type
     * throws without the permission, and NOT calling it earns a
     * ForegroundServiceDidNotStartInTimeException. Both kill the process, so
     * the only safe move is never to start in that state.
     */
    public static boolean hasLocationPermission(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                   == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                   == PackageManager.PERMISSION_GRANTED;
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
        try {
            if (powerReceiver != null) {
                unregisterReceiver(powerReceiver);
                powerReceiver = null;
            }
        } catch (Exception e) { /* ignore */ }
        try {
            if (sosGesture != null) {
                sosGesture.stop();
                sosGesture = null;
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
    //
    // The decision itself is LocationFilter's; this method measures the
    // distances, applies what comes back, and logs it. Splitting it that way is
    // what makes the gates testable without a handset — see LocationFilterTest.
    private void handleLocation(Location loc, String source) {
        if (loc == null) return;

        boolean hasLastPush = lastPushedLocation != null;
        boolean hasPending  = pendingJumpLocation != null;

        // Measured here, with Android's own WGS84 distance, exactly as before.
        float movedM      = hasLastPush ? lastPushedLocation.distanceTo(loc) : LocationFilter.NO_DISTANCE;
        float fromPending = hasPending  ? pendingJumpLocation.distanceTo(loc) : LocationFilter.NO_DISTANCE;
        long  sinceLastPush = hasLastPush ? System.currentTimeMillis() - lastPushTime : 0L;

        LocationFilter.Result verdict = LocationFilter.evaluate(
            loc.getAccuracy(), hasLastPush, movedM, sinceLastPush, hasPending, fromPending);

        if (verdict.note != null) Log.i(TAG, source + " " + verdict.note);

        if (verdict.holdAsPendingJump)     pendingJumpLocation = loc;
        else if (verdict.clearPendingJump) pendingJumpLocation = null;

        if (!verdict.shouldPush()) {
            if (verdict.outcome == LocationFilter.Outcome.REJECTED_JUMP) {
                Log.w(TAG, source + " " + verdict.detail);
            } else {
                Log.d(TAG, source + " " + verdict.detail);
            }
            return;
        }

        if (verdict.outcome == LocationFilter.Outcome.ACCEPTED_HEARTBEAT) {
            Log.i(TAG, source + " heartbeat push — stationary, refreshing timestamp");
        }
        Log.i(TAG, "✅ " + source + " " + verdict.detail);

        lastPushedLocation = loc;
        lastKnownForSos    = loc;
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
            // Math.round, not an (int) cast: the cast truncates, so 48.9% was
            // stored as 48 here while the JS writer (Math.round) stored 49 for
            // the same charge. Both paths write this column, so they have to
            // agree or the number jumps depending on which one wrote last.
            if (level >= 0 && scale > 0) battery = Math.round((level / (float) scale) * 100f);
            // EXTRA_PLUGGED, not just STATUS. MIUI (and most OEM "optimised
            // charging" schemes) report BATTERY_STATUS_NOT_CHARGING while the
            // cable is connected but current is paused — thermal limits, an
            // 80% charge cap, or simply being full. Reading STATUS alone made
            // a plugged-in phone show as not charging. Conversely STATUS can
            // linger on FULL briefly after unplugging, which showed the
            // opposite. EXTRA_PLUGGED answers the question actually being
            // asked: is this phone on power right now?
            // EXTRA_PLUGGED alone. BATTERY_STATUS lingers on CHARGING after the
            // cable is pulled — verified with `dumpsys battery unplug`, which
            // reported "USB powered: false" while status stayed 2 (CHARGING).
            // ORing STATUS in as a "safety net" therefore kept a phone showing
            // as charging after it was unplugged, which is the bug this was
            // meant to fix. EXTRA_PLUGGED is non-zero for every power source
            // (USB, AC, wireless, dock), so nothing is lost by dropping it.
            int plugged = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0);
            charging = plugged != 0;
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
            // Refreshing is split by lifecycle, because a Supabase refresh token is
            // single-use: redeeming one revokes it, so two holders cannot both spend
            // it. While the Activity is resumed the WebView owns the token and keeps
            // it fresh, pushing each new pair down via updateSessionToken(). A refresh
            // from here in that window is what produced "Invalid Refresh Token:
            // Already Used" on the JS side, which erases the session and drops the
            // user on the login screen.
            //
            // So defer while the app is in front and let the next heartbeat (~95s)
            // pick up the token JS will have installed by then. deferredAuthRetries
            // stops that becoming a deadlock: if the WebView is wedged or somehow
            // never refreshes, fall through and renew anyway rather than let
            // background tracking die.
            if (LocationPlugin.appInForeground && deferredAuthRetries < MAX_DEFERRED_AUTH_RETRIES) {
                deferredAuthRetries++;
                Log.i(TAG, "⏸️ Push rejected (" + code + ") while app is in front — leaving the refresh to the WebView ("
                        + deferredAuthRetries + "/" + MAX_DEFERRED_AUTH_RETRIES + ")");
                return;
            }
            deferredAuthRetries = 0;
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
            // No p_family_id: this reports to EVERY family the signed-in user
            // belongs to, not just the one that happens to be active in the
            // app. Scoped to one family, every other family froze at the last
            // position from when it was last active, and a family joined after
            // the service started never got a row at all — its members saw
            // "Waiting" forever while this service was pushing fixes happily to
            // a different family. familyId is still taken as a parameter: the
            // caller uses it to decide whether to run at all, and the direct
            // upsert fallback still needs it.
            //
            // This is the primary writer on Android — the JS path only runs
            // while the app is open — so the fix has to be here, not only in
            // useLocationBroadcast.js. Families the user has hidden their
            // location from are skipped server-side.
            JSONObject body = new JSONObject();
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

            URL url = new URL(supabaseUrl + "/rest/v1/rpc/upsert_location_all_families");
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
    //
    // Static and package-private so SosSender can reach it: an SOS rejected for a stale
    // token has to be able to renew and retry on its own, without a handle on the
    // service. It touches no instance state — only prefs and the two passed-in values.
    static boolean refreshAccessToken(SharedPreferences prefs, String supabaseUrl, String supabaseKey) {
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
            .setContentText(getString(R.string.notif_location_body))
            .setSubText(getString(R.string.notif_tap_to_open))
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
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, CHANNEL_ID,
                R.string.ch_location_name, R.string.ch_location_desc);
            return;
        }
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, ctx.getString(R.string.ch_location_name), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(ctx.getString(R.string.ch_location_desc));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    public static void startService(Context ctx) {
        // Refusing here is what keeps the app alive on a fresh install, where
        // the location permission has not been granted yet — see
        // hasLocationPermission above for why starting anyway is fatal rather
        // than merely useless. Callers may fire this optimistically; the
        // service starts for real once the permission is granted and
        // useLocationService asks again.
        if (!hasLocationPermission(ctx)) {
            Log.w(TAG, "startService skipped — location permission not granted yet");
            return;
        }

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
