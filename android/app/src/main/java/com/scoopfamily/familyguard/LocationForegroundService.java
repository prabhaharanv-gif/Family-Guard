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
import android.os.SystemClock;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
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
 *   - Adaptive interval: 5s while moving (accepting down to 3s), 30s once the
 *     phone has been still for two minutes (accepting down to 15s). Moving is
 *     the old always-on rate, so live tracking is unchanged; stillness is where
 *     the battery was going. See adaptCadence() and the constants for the
 *     measurements behind it.
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
    /**
     * The member's show_location preference, mirrored down from the web layer.
     *
     * It lives here because the start paths are native and none of them could
     * previously see it: useLocationService started the service on every launch
     * and BootReceiver restarted it after every reboot, both keyed only on
     * stored credentials. Turning sharing off stopped the service exactly once,
     * and the next launch or reboot silently resumed full-rate tracking for
     * somebody who had opted out — a privacy bug before it is a battery one.
     *
     * Absent means sharing is ON. Only an explicit false blocks a start: a
     * missing or unreadable preference must never silently stop a safety app
     * from tracking, so this fails open in the same spirit as useSingleDevice.
     */
    public static final String KEY_SHARING     = "show_location";

    /**
     * "Shake for SOS". Absent means OFF — the opposite of KEY_SHARING, on
     * purpose: a gesture that can alert the whole family must be chosen, never
     * inherited by default.
     */
    public static final String KEY_SHAKE_SOS   = "shake_sos";
    /** "Crash detection": off unless chosen, for the same reason as KEY_SHAKE_SOS. */
    public static final String KEY_CRASH_SOS   = "crash_sos";
    // The last pushed fix, persisted so a restart (app update, OEM kill,
    // reboot) does not forget it. Without it the first fix after every restart
    // was judged against nothing and accepted at up to 2km accuracy — on the
    // Redmi a 165m Wi-Fi guess, then a 100m one 95m away, before GPS put the
    // pin back. Also read by LocationPlugin.getLastFix for the web writer.
    public static final String KEY_LAST_LAT    = "last_push_lat";
    public static final String KEY_LAST_LNG    = "last_push_lng";
    public static final String KEY_LAST_ACC    = "last_push_acc";
    public static final String KEY_LAST_SPEED  = "last_push_speed";
    public static final String KEY_LAST_TIME   = "last_push_time";
    /** A saved fix older than this is not trusted as a baseline after a restart. */
    static final long LAST_PUSH_RESTORE_MAX_AGE_MS = 30 * 60 * 1000L;

    // Runs only while KEY_SHAKE_SOS is on; see syncShakeDetector.
    private ShakeSosDetector shakeDetector;
    // Runs only while KEY_CRASH_SOS is on; see syncCrashDetector.
    private CrashSosDetector crashDetector;

    // Watches for the phone losing data, so OfflineSms can text the family the
    // last known position when nothing else can reach them.
    private android.net.ConnectivityManager.NetworkCallback networkCallback;

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
    // How often to ask FusedLocationProvider for a fresh fix.
    //
    // This used to be a single 5s/3s pair applied around the clock, which meant
    // a phone lying still on a table ran the GNSS engine at essentially a 100%
    // duty cycle to produce fixes that LocationFilter then threw away: at rest
    // nothing is pushed until 15m of movement or the 90s heartbeat, so 17 of
    // every 18 fixes were computed and discarded. Measured on the Redmi
    // (2026-09-16): 9h50m of GPS and 5h46m of keep-awake against 4m of
    // foreground use, 23.5% of the battery.
    //
    // So the cadence now follows what the phone is actually doing. Moving keeps
    // the old rate exactly — live tracking must not regress — and stillness
    // costs a sixth of it.
    private static final long MOVING_INTERVAL_MS = 5_000L;
    private static final long MOVING_FASTEST_MS  = 3_000L;
    private static final long STILL_INTERVAL_MS  = 30_000L;
    private static final long STILL_FASTEST_MS   = 15_000L;

    // How long without real movement before dropping back to the slow cadence.
    // Long enough to ride through a traffic light rather than flapping at every
    // junction.
    private static final long STILL_AFTER_MS = 120_000L;

    // Speed that counts as moving on its own, without waiting to accumulate
    // MIN_MOVE_M of displacement — about 5.4 km/h, i.e. walking pace. This is
    // what keeps the start of a journey responsive: the first fix that reports
    // real speed switches to the fast cadence immediately.
    private static final float MOVING_SPEED_MPS = 1.5f;

    /**
     * Which cadence applies, and the only place that is decided. Plain Java,
     * no Android types, unit tested in CadencePlanTest. Main thread only —
     * fixes are delivered on the main looper.
     */
    private final CadencePlan cadence = new CadencePlan(STILL_AFTER_MS);

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

    // The volume-button SOS gesture used to be started from here. Withdrawn
    // 2026-09-16 — see VolumeSosGesture for what it did to the phone and why
    // that was not worth the trigger. (powerReceiver further down is unrelated:
    // it is about the charger.)
    // Timestamp of the last push — used for the stationary heartbeat
    private long lastPushTime = 0L;
    // An implausibly-fast fix awaiting a second fix to confirm it isn't a GPS jump
    private Location pendingJumpLocation = null;
    // When pendingJumpLocation was held, and when the current unbroken run of
    // rejected jumps began — LocationFilter accepts rather than hold forever.
    private long pendingJumpTime = 0L;
    private long jumpHoldStartTime = 0L;

    // Stale-fix and unconfirmed-far-fix guard (see TeleportGuard), and the last
    // time a GPS-quality fix showed the phone really moving.
    private final TeleportGuard teleportGuard = new TeleportGuard();
    private Location teleportCandidate = null;
    private long lastMotionTime = 0L;

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
        restoreLastPush();
    }

    /** Reload the last pushed fix saved by rememberLastPush, if it is recent. */
    private void restoreLastPush() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            long t = prefs.getLong(KEY_LAST_TIME, 0L);
            if (t <= 0L || System.currentTimeMillis() - t > LAST_PUSH_RESTORE_MAX_AGE_MS) return;
            Location l = new Location("restored");
            l.setLatitude(Double.longBitsToDouble(prefs.getLong(KEY_LAST_LAT, 0L)));
            l.setLongitude(Double.longBitsToDouble(prefs.getLong(KEY_LAST_LNG, 0L)));
            l.setAccuracy(prefs.getFloat(KEY_LAST_ACC, LocationFilter.MAX_ACCURACY_M));
            l.setTime(t);
            lastPushedLocation = l;
            lastPushTime = t;
            Log.i(TAG, "restored last push — accuracy=" + l.getAccuracy() + "m, "
                + ((System.currentTimeMillis() - t) / 1000) + "s old");
        } catch (Exception e) {
            Log.w(TAG, "could not restore last push: " + e.getMessage());
        }
    }

    private void rememberLastPush(Location loc, long time) {
        getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit()
            .putLong(KEY_LAST_LAT, Double.doubleToRawLongBits(loc.getLatitude()))
            .putLong(KEY_LAST_LNG, Double.doubleToRawLongBits(loc.getLongitude()))
            .putFloat(KEY_LAST_ACC, loc.getAccuracy())
            .putFloat(KEY_LAST_SPEED, loc.hasSpeed() ? loc.getSpeed() : -1f)
            .putLong(KEY_LAST_TIME, time)
            .apply();
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
        syncShakeDetector();
        syncCrashDetector();
        watchConnectivity();
        if (executor != null) executor.submit(this::seedPlaces);
        Log.i(TAG, "Location foreground service started — FusedLocationProvider");
        return START_STICKY;
    }

    /**
     * Tracks whether the phone has usable internet. Registered once; a second
     * onStartCommand finds the callback already in place.
     *
     * Only the transitions are recorded here — whether a message actually goes
     * out is OfflineSmsPlan's decision, evaluated on each location fix.
     */
    private void watchConnectivity() {
        if (networkCallback != null) return;
        try {
            android.net.ConnectivityManager cm =
                (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;

            networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(android.net.Network network) {
                    OfflineSms.setOnline(getApplicationContext(), true);
                }
                @Override public void onLost(android.net.Network network) {
                    OfflineSms.setOnline(getApplicationContext(), false);
                }
                // Wi-Fi <-> mobile data: tell the family card now rather than
                // with the next position (up to ~2 min when not moving).
                @Override public void onCapabilitiesChanged(android.net.Network network,
                                                            android.net.NetworkCapabilities caps) {
                    scheduleNetworkReport();
                }
            };
            cm.registerDefaultNetworkCallback(networkCallback);

            // The callback only reports changes, so the current state has to be
            // read once: a service started while already offline would otherwise
            // never arm the alerts.
            android.net.Network active = cm.getActiveNetwork();
            android.net.NetworkCapabilities caps = active != null ? cm.getNetworkCapabilities(active) : null;
            boolean online = caps != null
                && caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
            OfflineSms.setOnline(getApplicationContext(), online);
        } catch (Exception e) {
            Log.w(TAG, "Could not watch connectivity: " + e.getMessage());
            networkCallback = null;
        }
    }

    // ── Network type reported the moment it changes ─────────────────────────
    // The family card's signal icon otherwise only moved with a position push.
    // Only a change of TYPE (Wi-Fi <-> mobile) is sent here; bar levels still
    // ride along with the regular pushes, since capabilities callbacks fire on
    // every small RSSI wobble and that would mean constant writes.

    /** The network type the server last heard from us; set by both writers. */
    private volatile String lastSentNetType = null;

    /** Waits for a hand-over to settle: switching networks fires several callbacks. */
    private static final long NETWORK_REPORT_DEBOUNCE_MS = 3000;

    private final Runnable networkReport = () -> {
        ExecutorService ex = executor;
        if (ex != null && !ex.isShutdown()) ex.submit(this::pushNetworkIfChanged);
    };

    private void scheduleNetworkReport() {
        Handler h = mainHandler;
        if (h == null) return;
        h.removeCallbacks(networkReport);
        h.postDelayed(networkReport, NETWORK_REPORT_DEBOUNCE_MS);
    }

    // ── Places (geofencing): "reached Home" / "left Home" ───────────────────
    // The state machine and the two-fix confirmation live in PlaceGeofence,
    // which is plain Java and unit tested (PlaceGeofenceTest); this service
    // only feeds it fixes and reports what it confirms. See its class doc for
    // why the check runs ahead of the push-quality gate above.

    private final PlaceGeofence placeGeofence = new PlaceGeofence();
    private volatile long lastPlacesRefreshTime = 0L;
    // Safety net only — the normal path is refreshPlaces() restarting the
    // service right after a places CRUD, same mechanism setShakeSosEnabled
    // already uses to pick up a settings change.
    private static final long PLACES_REFRESH_INTERVAL_MS = 3_600_000L;

    /** Re-fetches this member's places from the server and reloads PlaceGeofence. */
    private void seedPlaces() {
        SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(KEY_URL, null);
        String supabaseKey = prefs.getString(KEY_KEY, null);
        String session     = prefs.getString(KEY_SESSION, null);
        if (supabaseUrl == null || supabaseKey == null || session == null) return;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(supabaseUrl + "/rest/v1/rpc/list_my_places").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey",        supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write("{}".getBytes("UTF-8"));
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "list_my_places failed HTTP " + code);
                return;
            }

            StringBuilder sb = new StringBuilder();
            try (java.io.BufferedReader br = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }

            JSONArray rows = new JSONArray(sb.toString());
            List<PlaceGeofence.Place> places = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                org.json.JSONObject row = rows.getJSONObject(i);
                places.add(new PlaceGeofence.Place(
                    row.getString("id"),
                    row.getString("name"),
                    row.getDouble("lat"),
                    row.getDouble("lng"),
                    row.getInt("radius_m"),
                    row.getBoolean("currently_inside")
                ));
            }
            placeGeofence.setPlaces(places);
            Log.i(TAG, "places refreshed — " + places.size() + " saved");
        } catch (Exception e) {
            Log.w(TAG, "seedPlaces failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Reports one confirmed arrival/departure, with the same auth-retry as reportLocationEnabled. */
    private void reportPlaceTransition(PlaceGeofence.Transition t) {
        SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(KEY_URL, null);
        String supabaseKey = prefs.getString(KEY_KEY, null);
        String session     = prefs.getString(KEY_SESSION, null);
        if (supabaseUrl == null || supabaseKey == null || session == null) return;

        int code = postPlaceTransition(supabaseUrl, supabaseKey, session, t);
        if (SosResponse.isAuthFailure(code)) {
            Log.w(TAG, "report_place_transition rejected (HTTP " + code + ") — renewing and retrying once");
            if (refreshAccessToken(prefs, supabaseUrl, supabaseKey)) {
                String renewed = prefs.getString(KEY_SESSION, null);
                code = postPlaceTransition(supabaseUrl, supabaseKey, renewed, t);
            }
        }
        Log.i(TAG, "place_transition " + t.placeName + " entered=" + t.entered + " -> HTTP " + code);
    }

    private int postPlaceTransition(String supabaseUrl, String supabaseKey, String session,
                                    PlaceGeofence.Transition t) {
        if (session == null) return SosResponse.NO_RESPONSE;

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_place_id", t.placeId);
            body.put("p_entered",  t.entered);

            conn = (HttpURLConnection) new URL(supabaseUrl + "/rest/v1/rpc/report_place_transition").openConnection();
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
            Log.w(TAG, "report_place_transition failed — " + e.getMessage());
            return SosResponse.NO_RESPONSE;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * Called right after any places CRUD from the UI, and by the hourly
     * safety-net timer above. Mirrors setShakeSosEnabled's mechanism exactly:
     * a running service is restarted, which re-runs seedPlaces() from
     * onStartCommand; there is nothing to do when not running because
     * onStartCommand seeds fresh places on the next real start anyway.
     */
    public static void refreshPlaces(Context ctx) {
        if (isRunning) startService(ctx);
    }

    private void pushNetworkIfChanged() {
        NetworkSignal.Reading sig = NetworkSignal.read(getApplicationContext());
        if (sig.type == null || sig.type.equals(lastSentNetType)) return;

        android.content.SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(KEY_URL, null);
        String supabaseKey = prefs.getString(KEY_KEY, null);
        String session     = prefs.getString(KEY_SESSION, null);
        // No session means nothing to write as; the next position push, which
        // owns token renewal, will carry the network instead.
        if (supabaseUrl == null || supabaseKey == null || session == null) return;

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_network_type", sig.type);
            if (sig.level >= 0) body.put("p_signal_level", sig.level);

            conn = (HttpURLConnection) new URL(supabaseUrl + "/rest/v1/rpc/set_network_status").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey",        supabaseKey);
            conn.setRequestProperty("Authorization", "Bearer " + session);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            int code = conn.getResponseCode();
            if (code == 200 || code == 204) {
                lastSentNetType = sig.type;
                Log.i(TAG, "📶 Network now " + sig.type + " (" + sig.level + "/4) — reported");
            } else {
                // Deliberately no token refresh here: that belongs to the
                // position push, and two refreshers spending one single-use
                // refresh token is what used to log members out.
                Log.w(TAG, "Network report failed HTTP " + code + " — the next push will carry it");
            }
        } catch (Exception e) {
            Log.w(TAG, "Network report error: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Starts or stops the crash detector to match the stored preference. */
    private void syncCrashDetector() {
        if (isCrashSosEnabled(this)) {
            if (crashDetector == null) crashDetector = new CrashSosDetector(this);
            crashDetector.start();
        } else if (crashDetector != null) {
            crashDetector.stop();
            crashDetector = null;
        }
    }

    public static boolean isCrashSosEnabled(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                      .getBoolean(KEY_CRASH_SOS, false);
        } catch (Exception e) {
            return false;
        }
    }

    /** Stores the choice and applies it now (a running service is re-started to pick it up). */
    public static void setCrashSosEnabled(Context ctx, boolean enabled) {
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
               .edit().putBoolean(KEY_CRASH_SOS, enabled).commit();
        } catch (Exception e) {
            Log.w(TAG, "Could not store the crash detection preference: " + e.getMessage());
        }
        if (isRunning) startService(ctx);
    }

    /** Starts or stops the shake detector to match the stored preference. */
    private void syncShakeDetector() {
        boolean wanted = isShakeSosEnabled(this);
        if (wanted) {
            if (shakeDetector == null) shakeDetector = new ShakeSosDetector(this);
            shakeDetector.start();
        } else if (shakeDetector != null) {
            shakeDetector.stop();
            shakeDetector = null;
        }
    }

    public static boolean isShakeSosEnabled(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                      .getBoolean(KEY_SHAKE_SOS, false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Stores the choice and applies it now. The detector lives in this service,
     * so a running service is re-started to pick it up; when the service is not
     * running (sharing off) the choice waits for the next start.
     */
    public static void setShakeSosEnabled(Context ctx, boolean enabled) {
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
               .edit().putBoolean(KEY_SHAKE_SOS, enabled).commit();
        } catch (Exception e) {
            Log.w(TAG, "Could not store the shake SOS preference: " + e.getMessage());
        }
        if (isRunning) startService(ctx);
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
        if (crashDetector != null) {
            crashDetector.stop();
            crashDetector = null;
        }
        if (shakeDetector != null) {
            shakeDetector.stop();
            shakeDetector = null;
        }
        if (mainHandler != null) mainHandler.removeCallbacks(networkReport);
        try {
            if (networkCallback != null) {
                android.net.ConnectivityManager cm =
                    (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
                networkCallback = null;
            }
        } catch (Exception e) { /* ignore */ }
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

        // getForegroundService, NOT getService, on O+. A PendingIntent built
        // with getService performs a plain startService when it fires, and from
        // Android 8 a background startService throws IllegalStateException —
        // which lands inside AlarmManager's dispatch, where nothing here can
        // catch or report it. So the swipe-away restart this method exists to
        // perform has been failing silently on every modern Android: the member
        // swiped the app away and their location simply stopped, for good.
        PendingIntent restartPending = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? PendingIntent.getForegroundService(
                getApplicationContext(), 1, restartIntent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE)
            : PendingIntent.getService(
                getApplicationContext(), 1, restartIntent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);

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
        // onStartCommand runs again on every startService() — app launch, the
        // sign-in retry chain in useLocationService (every 5s until a token
        // arrives), a failed-start retry, a START_STICKY restart, BootReceiver.
        // Each pass used to build a NEW LocationCallback and register it while
        // the field still pointed at the old one, so the previous callback
        // stayed registered with Play Services and became unreachable: nothing
        // could remove it, onDestroy included. The requests stacked, and every
        // fix was delivered once per leaked callback — each one re-running the
        // distance maths and its own 90s heartbeat push.
        //
        // Unregister before re-registering. Safe when it was never registered.
        if (locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (Exception e) {
                Log.w(TAG, "Could not remove the previous location callback: " + e.getMessage());
            }
            locationCallback = null;
        }

        long interval = cadence.isMoving() ? MOVING_INTERVAL_MS : STILL_INTERVAL_MS;
        long fastest  = cadence.isMoving() ? MOVING_FASTEST_MS  : STILL_FASTEST_MS;

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, interval)
            .setMinUpdateIntervalMillis(fastest)
            // minUpdateDistance stays 0 in BOTH modes, and must. The 90s
            // heartbeat that keeps a stationary member's pin "live" is evaluated
            // in handleLocation, which only runs when a fix is delivered — so a
            // displacement filter would stop deliveries exactly when the phone is
            // still, the heartbeat would never fire, and the member would go
            // stale and then show as offline. Slowing the interval saves the
            // power; a distance filter would break the feature.
            .setMinUpdateDistanceMeters(0f)
            .setWaitForAccurateLocation(false)
            // Deliberately no setMaxUpdateDelayMillis: batching lets the system
            // hold fixes back to save more power, but this is a safety app and a
            // held-back fix is a stale position at the moment it matters.
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

        // Crash detection reads every raw fix, before any filtering: the speed
        // collapse it looks for is exactly what the push gates below would hold back.
        if (crashDetector != null) crashDetector.onFix(loc);

        // Phone lost mode: ends at its deadline, rings when due.
        LostPhone.tick(this);

        // A fix that is really a memory (the provider's cached last position) or
        // a far-away one-off on a phone that has not moved must reach neither the
        // pin nor the Places check: it made a phone sitting at home announce
        // "Reached / Left" every few minutes. See TeleportGuard.
        long nowGuard = System.currentTimeMillis();
        if (loc.hasSpeed() && loc.getSpeed() >= PlaceGeofence.MOVING_MPS
                && loc.hasAccuracy() && loc.getAccuracy() <= PlaceGeofence.MOTION_ACCURACY_M) {
            lastMotionTime = nowGuard;
        }
        long fixAgeMs = loc.getElapsedRealtimeNanos() > 0
            ? (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1_000_000L : 0L;
        if (TeleportGuard.isStale(fixAgeMs)) {
            Log.d(TAG, source + " fix ignored — " + (fixAgeMs / 1000) + "s old, a cached position, not a reading");
            return;
        }
        boolean guardBaseline = lastPushedLocation != null;
        float guardMoved = guardBaseline ? lastPushedLocation.distanceTo(loc) : TeleportGuard.NO_DISTANCE;
        float guardFromCandidate = teleportCandidate != null
            ? teleportCandidate.distanceTo(loc) : TeleportGuard.NO_DISTANCE;
        if (teleportGuard.shouldHold(guardBaseline, guardMoved,
                guardBaseline ? nowGuard - lastPushTime : 0L,
                nowGuard - lastMotionTime <= TeleportGuard.MOTION_WINDOW_MS && lastMotionTime != 0L,
                guardFromCandidate, nowGuard)) {
            // Measured from the LATEST held fix, so a vehicle keeps counting as one move.
            teleportCandidate = loc;
            Log.w(TAG, source + " fix held — " + guardMoved + "m from the last position with no movement seen; waiting to see if it lasts");
            return;
        }
        if (!teleportGuard.hasCandidate()) teleportCandidate = null;

        // Places (geofencing) run on every raw fix, deliberately BEFORE and
        // independent of the push-worthiness gate below: that gate exists to
        // decide what is worth writing to the map trail, and can hold a fix
        // back for up to HEARTBEAT_MS or drop it outright below
        // LocationFilter.MAX_ACCURACY_M — exactly the kind of fix you get
        // walking into a building. See PlaceGeofence's class doc.
        for (PlaceGeofence.Transition t : placeGeofence.checkFix(loc)) {
            Log.i(TAG, (t.entered ? "📍 Reached " : "📍 Left ") + t.placeName);
            executor.submit(() -> reportPlaceTransition(t));
        }
        long nowForPlaces = System.currentTimeMillis();
        if (nowForPlaces - lastPlacesRefreshTime > PLACES_REFRESH_INTERVAL_MS) {
            lastPlacesRefreshTime = nowForPlaces;
            executor.submit(this::seedPlaces);
        }

        boolean hasLastPush = lastPushedLocation != null;
        boolean hasPending  = pendingJumpLocation != null;

        // Measured here, with Android's own WGS84 distance, exactly as before.
        float movedM      = hasLastPush ? lastPushedLocation.distanceTo(loc) : LocationFilter.NO_DISTANCE;
        float fromPending = hasPending  ? pendingJumpLocation.distanceTo(loc) : LocationFilter.NO_DISTANCE;
        long  now = System.currentTimeMillis();
        long  sinceLastPush = hasLastPush ? now - lastPushTime : 0L;
        // Lost mode: report every few seconds even when standing still, by treating
        // the last push as old enough for the heartbeat to be due.
        if (hasLastPush && LostPhone.isActive(this) && sinceLastPush >= LostModePlan.PUSH_EVERY_MS) {
            sinceLastPush = Math.max(sinceLastPush, LocationFilter.HEARTBEAT_MS);
        }
        long  sincePending  = hasPending  ? now - pendingJumpTime : 0L;
        long  holdingJumps  = hasPending  ? now - jumpHoldStartTime : 0L;

        float lastAcc = hasLastPush && lastPushedLocation.hasAccuracy()
            ? lastPushedLocation.getAccuracy() : LocationFilter.NO_DISTANCE;
        LocationFilter.Result verdict = LocationFilter.evaluate(
            loc.getAccuracy(), lastAcc, hasLastPush, movedM, sinceLastPush,
            hasPending, fromPending, sincePending, holdingJumps);

        // Decided from the distances already measured above, before the verdict
        // is applied: a rejected fix still tells us whether the phone is moving.
        adaptCadence(loc, movedM);

        if (verdict.note != null) Log.i(TAG, source + " " + verdict.note);

        if (verdict.holdAsPendingJump) {
            if (pendingJumpLocation == null) jumpHoldStartTime = now;
            pendingJumpLocation = loc;
            pendingJumpTime     = now;
        } else if (verdict.clearPendingJump) {
            pendingJumpLocation = null;
        }

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

        // A heartbeat carrying a less precise fix re-sends the position already
        // on the map, freshly stamped, instead of moving the pin onto it.
        final Location toPush;
        if (verdict.keepLastPosition && lastPushedLocation != null) {
            toPush = new Location(lastPushedLocation);
            toPush.setTime(System.currentTimeMillis());
            if (loc.hasSpeed()) toPush.setSpeed(loc.getSpeed());
        } else {
            toPush = loc;
        }
        lastPushedLocation = toPush;
        lastKnownForSos    = toPush;
        lastPushTime = System.currentTimeMillis();
        rememberLastPush(toPush, lastPushTime);
        executor.submit(() -> pushLocation(toPush));
        // With no data the push above goes nowhere; this is the fallback that
        // still reaches the family. Cheap unless an alert is actually due.
        executor.submit(() -> OfflineSms.maybeSend(getApplicationContext(), toPush));
    }

    /**
     * Switches between the moving and stationary cadences.
     *
     * Movement is either real displacement (the same MIN_MOVE_M the push gate
     * uses, so the two agree about what "moved" means) or a reported speed at
     * walking pace or above. Speed is what makes the start of a journey
     * responsive: waiting to accumulate 15m at the slow cadence could take two
     * ticks, while the first fix that reports speed switches immediately.
     *
     * Dropping back is deliberately slow (STILL_AFTER_MS) so a wait at a
     * junction or a red light does not churn the request. The switch itself
     * re-registers the callback, which is safe and cheap only because
     * startLocationUpdates() removes the previous one first.
     */
    private void adaptCadence(Location loc, float movedM) {
        boolean movedFar   = movedM != LocationFilter.NO_DISTANCE && movedM >= LocationFilter.MIN_MOVE_M;
        boolean movingFast = (loc.hasSpeed() && loc.getSpeed() >= MOVING_SPEED_MPS)
            || LostPhone.isActive(this);   // lost mode keeps the fast cadence

        if (!cadence.update(movedFar, movingFast, System.currentTimeMillis())) return;

        Log.i(TAG, "cadence → " + (cadence.isMoving()
            ? "moving (" + (MOVING_INTERVAL_MS / 1000) + "s)"
            : "stationary (" + (STILL_INTERVAL_MS / 1000) + "s)"));
        startLocationUpdates();
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
        if (code == 200 || code == 201 || code == 204) {
            // Reaching the server again retires any standing prompt, so a member
            // who reopened the app (or whose network simply came back) is not
            // left looking at a warning that no longer applies.
            clearReauthNotice();
        }

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
                // Say so where somebody can act on it. This branch is the
                // silent-death path: the service stays up, holds GPS, and every
                // push from here on is rejected, so the family sees a position
                // frozen at wherever the phone was when the token expired while
                // every indicator claims sharing is on. Opening the app fixes it
                // in one tap — but nothing ever asked anyone to.
                notifyReauthNeeded();
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
            // Network for the family card's signal icon. Omitted when unknown,
            // which leaves the stored reading as it was (migration 20260922120000).
            NetworkSignal.Reading sig = NetworkSignal.read(getApplicationContext());
            if (sig.type != null) {
                body.put("p_network_type", sig.type);
                if (sig.level >= 0) body.put("p_signal_level", sig.level);
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
                if (sig.type != null) lastSentNetType = sig.type;
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
    //
    // Goes through TokenBroker, the single lock that the WebView's refreshes also
    // pass through. Redeeming here independently is what signed users out: the
    // WebView and this service spent the same single-use token, and Supabase
    // revoked the whole session.
    static boolean refreshAccessToken(SharedPreferences prefs, String supabaseUrl, String supabaseKey) {
        return TokenBroker.redeem(prefs, supabaseUrl, supabaseKey, null).ok();
    }

    // ── Re-authentication prompt ──────────────────────────────────────────────
    public static final String REAUTH_CHANNEL_ID = "fg_reauth_v1";
    private static final int    REAUTH_NOTIF_ID  = 2002;
    /** Don't repeat the prompt more than this often. */
    private static final long   REAUTH_NOTIFY_EVERY_MS = 60 * 60 * 1000L;
    private static long lastReauthNotifiedAt = 0L;

    /**
     * Tells the member their location has stopped reaching the family and that
     * opening the app fixes it.
     *
     * Its own channel at DEFAULT importance, not the silent one the ongoing
     * service notification uses: that one is deliberately invisible, and a
     * prompt nobody notices is the same as the log line this replaces. Throttled
     * to once an hour, because the failing push repeats on every fix.
     */
    private void notifyReauthNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastReauthNotifiedAt < REAUTH_NOTIFY_EVERY_MS) return;
        lastReauthNotifiedAt = now;

        try {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(
                    REAUTH_CHANNEL_ID, getString(R.string.ch_reauth_name),
                    NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription(getString(R.string.ch_reauth_desc));
                nm.createNotificationChannel(ch);
            }

            Intent tapIntent = new Intent(this, MainActivity.class);
            tapIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 2, tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            nm.notify(REAUTH_NOTIF_ID, new NotificationCompat.Builder(this, REAUTH_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(getString(R.string.notif_reauth_title))
                .setContentText(getString(R.string.notif_reauth_body))
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText(getString(R.string.notif_reauth_body)))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build());
        } catch (Exception e) {
            Log.w(TAG, "Could not post the re-auth prompt: " + e.getMessage());
        }
    }

    /** Clears the prompt once pushes are landing again. */
    private void clearReauthNotice() {
        lastReauthNotifiedAt = 0L;
        try {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(REAUTH_NOTIF_ID);
        } catch (Exception e) { /* ignore */ }
    }

    // ── Notification ──────────────────────────────────────────────────────────
    private Notification buildNotification() {
        return buildNotification(this);
    }

    private static Notification buildNotification(Context ctx) {
        Intent tapIntent = new Intent(ctx, MainActivity.class);
        tapIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("🛡️ Famora")
            .setContentText(ctx.getString(R.string.notif_location_body))
            .setSubText(ctx.getString(R.string.notif_tap_to_open))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pi);

        // The fake-call trigger that works from the lock screen. Opt-in, because
        // the button is readable by anyone who picks the phone up.
        if (FakeCallPrefs.notificationButton(ctx)) {
            b.addAction(0, ctx.getString(R.string.fake_call_notification_action),
                FakeCallService.notificationButtonIntent(ctx));
        }
        return b.build();
    }

    /** Redraws the ongoing notification after a setting that changes it. No-op when not running. */
    static void refreshNotification(Context ctx) {
        if (!isRunning) return;
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(ctx.getApplicationContext()));
        } catch (Exception e) {
            Log.w(TAG, "Could not refresh the notification: " + e.getMessage());
        }
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

        // One check covering every start path — the JS call, its retry chain,
        // and BootReceiver — so opting out survives a relaunch and a reboot.
        if (!isSharingEnabled(ctx)) {
            Log.i(TAG, "startService skipped — member has location sharing off");
            return;
        }

        ensureChannel(ctx);
        Intent intent = new Intent(ctx, LocationForegroundService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception e) {
            // From Android 12 a background foreground-service start can be
            // refused outright (ForegroundServiceStartNotAllowedException). This
            // is called from a broadcast receiver and from a boot receiver,
            // where throwing would take the process down instead of simply
            // failing to start. The watchdog will try again on its next tick.
            Log.w(TAG, "startService refused — " + e.getMessage());
            return;
        }
        scheduleWatchdog(ctx);
    }

    // ── Watchdog ──────────────────────────────────────────────────────────────
    // Roughly every 15 minutes, check the service is still alive and restart it
    // if not. See ServiceWatchdogReceiver for why this is necessary at all.
    private static final long WATCHDOG_INTERVAL_MS = 15 * 60 * 1000L;
    private static final int  WATCHDOG_REQUEST_CODE = 7301;

    private static PendingIntent watchdogIntent(Context ctx) {
        Intent i = new Intent(ctx.getApplicationContext(), ServiceWatchdogReceiver.class);
        i.setPackage(ctx.getPackageName());
        return PendingIntent.getBroadcast(
            ctx.getApplicationContext(), WATCHDOG_REQUEST_CODE, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Arms the periodic check. Inexact on purpose — the system may batch it with
     * other wakeups, which is exactly what a backstop should allow.
     */
    static void scheduleWatchdog(Context ctx) {
        try {
            android.app.AlarmManager alarm =
                (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (alarm == null) return;
            alarm.setInexactRepeating(
                android.app.AlarmManager.ELAPSED_REALTIME_WAKEUP,
                android.os.SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS,
                WATCHDOG_INTERVAL_MS,
                watchdogIntent(ctx));
        } catch (Exception e) {
            Log.w(TAG, "Could not arm the watchdog: " + e.getMessage());
        }
    }

    /**
     * Disarms it. Called wherever the service is stopped deliberately, so that
     * "off" means off: a member who turned sharing off, or signed out, must not
     * have the service quietly restarted 15 minutes later.
     */
    static void cancelWatchdog(Context ctx) {
        try {
            android.app.AlarmManager alarm =
                (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (alarm != null) alarm.cancel(watchdogIntent(ctx));
        } catch (Exception e) {
            Log.w(TAG, "Could not cancel the watchdog: " + e.getMessage());
        }
    }

    public static void stopService(Context ctx) {
        // Disarm first: every caller here is a deliberate stop (sharing turned
        // off, sign-out, the plugin's stop()), and the watchdog must not undo a
        // decision the user made.
        cancelWatchdog(ctx);
        ctx.stopService(new Intent(ctx, LocationForegroundService.class));
        isRunning = false;
    }

    /**
     * Whether the member has left location sharing on. Defaults to true — see
     * KEY_SHARING for why this fails open.
     */
    public static boolean isSharingEnabled(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                      .getBoolean(KEY_SHARING, true);
        } catch (Exception e) {
            Log.w(TAG, "Could not read the sharing preference, assuming on: " + e.getMessage());
            return true;
        }
    }

    /**
     * Mirrors the member's show_location preference down and applies it at once:
     * turning sharing off stops tracking now, turning it back on resumes it
     * without waiting for the next app launch.
     */
    public static void setSharingEnabled(Context ctx, boolean enabled) {
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
               .edit().putBoolean(KEY_SHARING, enabled).commit();
        } catch (Exception e) {
            Log.w(TAG, "Could not store the sharing preference: " + e.getMessage());
        }
        if (enabled) startService(ctx);
        else         stopService(ctx);
    }

    /**
     * Forgets the signed-in member: stops tracking and clears everything the
     * service and BootReceiver key off.
     *
     * Without this, signing out left the service running with a dead token and
     * left userId/familyId/url in place, so a reboot restarted tracking for an
     * account nobody was signed into — with no way to stop it from the UI,
     * because reaching the privacy toggle requires being signed in.
     *
     * The sharing preference is deliberately NOT cleared here: it belongs to the
     * person, not the session, and clearing it would silently re-enable tracking
     * for someone who had opted out and then signed out and back in.
     */
    public static void clearSession(Context ctx) {
        stopService(ctx);
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
               .edit()
               .remove(KEY_USER_ID)
               .remove(KEY_FAMILY_ID)
               .remove(KEY_SESSION)
               .remove(KEY_REFRESH)
               .remove(TokenBroker.KEY_SESSION_JSON)
               // The saved position belongs to the signed-in session too.
               .remove(KEY_LAST_LAT).remove(KEY_LAST_LNG).remove(KEY_LAST_ACC)
               .remove(KEY_LAST_SPEED).remove(KEY_LAST_TIME)
               .commit();
            Log.i(TAG, "Native session cleared on sign-out");
        } catch (Exception e) {
            Log.w(TAG, "Could not clear the native session: " + e.getMessage());
        }
    }
}
