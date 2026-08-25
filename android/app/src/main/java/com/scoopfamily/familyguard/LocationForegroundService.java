package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
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
 * LocationForegroundService
 *
 * A persistent Android foreground service that continuously tracks the user's
 * GPS location and pushes updates to Supabase via the upsert_location_with_battery
 * RPC — even when the app is force-killed by the system or swiped away by the user.
 *
 * How it works:
 *   - Uses FusedLocationProviderClient (Google Play Services) for accurate, battery-
 *     efficient GPS — same API Android's own Maps app uses.
 *   - Updates every 30 seconds (or when device moves > 10 metres).
 *   - Shows a persistent low-priority notification: "🛡️ FamilyGuard is protecting your family"
 *   - When location sharing is disabled by the user (Profile → Show My Location off),
 *     the service is stopped from JS via LocationPlugin.
 *   - Reads supabaseUrl, supabaseKey, userId, familyId from SharedPreferences
 *     (written by LocationPlugin when the service is started).
 */
public class LocationForegroundService extends Service {

    private static final String TAG          = "FG_Location";
    public  static final String CHANNEL_ID   = "fg_location_v1";
    public  static final int    NOTIF_ID     = 2001;
    public  static boolean      isRunning    = false;

    // Extras written by LocationPlugin before starting the service
    public static final String PREF_NAME      = "fg_location_prefs";
    public static final String KEY_URL        = "supabase_url";
    public static final String KEY_KEY        = "supabase_key";
    public static final String KEY_USER_ID    = "user_id";
    public static final String KEY_FAMILY_ID  = "family_id";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback            locationCallback;
    private ExecutorService             executor;

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public void onCreate() {
        super.onCreate();
        executor    = Executors.newSingleThreadExecutor();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        ensureChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        startForeground(NOTIF_ID, buildNotification());
        startLocationUpdates();
        Log.i(TAG, "Location foreground service started");
        // START_STICKY — Android will restart this service if it's killed
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        if (executor != null) executor.shutdownNow();
        Log.i(TAG, "Location foreground service stopped");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Location updates ─────────────────────────────────────────────────────
    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, 15_000L) // every 15 seconds
            .setMinUpdateDistanceMeters(5f)               // or if moved > 5m
            .setWaitForAccurateLocation(false)
            .setMaxUpdateDelayMillis(30_000L)             // max 30s delay
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                Location loc = result.getLastLocation();
                if (loc != null) {
                    executor.submit(() -> pushLocation(loc));
                }
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing: " + e.getMessage());
            stopSelf();
        }
    }

    // ── Push location to Supabase RPC ────────────────────────────────────────
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

        // Battery level
        android.content.Intent batteryIntent = registerReceiver(null,
            new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
        int battery   = -1;
        boolean charging = false;
        if (batteryIntent != null) {
            int level = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
            int scale = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
            int status = batteryIntent.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
            if (level >= 0 && scale > 0) battery = (int)((level / (float) scale) * 100);
            charging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                    || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
        }

        // Speed (m/s → km/h)
        float speedKmh = loc.hasSpeed() ? loc.getSpeed() * 3.6f : 0f;

        try {
            JSONObject body = new JSONObject();
            body.put("p_family_id",  familyId);
            body.put("p_lat",        loc.getLatitude());
            body.put("p_lng",        loc.getLongitude());
            body.put("p_accuracy",   loc.getAccuracy());
            body.put("p_speed",      speedKmh);
            if (battery >= 0) {
                body.put("p_battery",     battery);
                body.put("p_is_charging", charging);
            }

            // Call Supabase RPC with service-role-equivalent anon key + user JWT
            // We use the stored session token from SharedPreferences
            String sessionToken = prefs.getString("session_token", null);
            String authHeader = sessionToken != null
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
                Log.i(TAG, "✅ Location pushed: " + loc.getLatitude() + "," + loc.getLongitude()
                    + " bat=" + battery + "% spd=" + String.format("%.1f", speedKmh) + "km/h");
            } else {
                // Read error body for diagnosis
                java.io.InputStream errStream = conn.getErrorStream();
                String errBody = "";
                if (errStream != null) {
                    try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(errStream))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        errBody = sb.toString();
                    } catch (Exception ignored) {}
                }
                Log.w(TAG, "❌ Push failed HTTP " + code + " body=" + errBody);
                // If 401/403 — session token expired, log it clearly
                if (code == 401 || code == 403) {
                    Log.e(TAG, "Session token expired — JS needs to call updateSessionToken()");
                }
            }
            conn.disconnect();

        } catch (Exception e) {
            Log.e(TAG, "Push error: " + e.getMessage());
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────
    private Notification buildNotification() {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("🛡️ FamilyGuard")
            .setContentText("Protecting your family · location active")
            .setSubText("Tap to open")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pi)
            .build();
    }

    // ── Notification channel ─────────────────────────────────────────────────
    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Location Tracking", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows while FamilyGuard is tracking your location");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    // ── Static helpers called from MainActivity / LocationPlugin ─────────────
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
