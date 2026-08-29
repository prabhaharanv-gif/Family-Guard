package com.scoopfamily.familyguard;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * LocationPlugin — Capacitor bridge between JS and LocationForegroundService.
 *
 * JS usage:
 *   import { registerPlugin } from '@capacitor/core'
 *   const LocationService = registerPlugin('LocationService')
 *
 *   // Start (call when user opens app / enables location sharing)
 *   await LocationService.start({
 *     supabaseUrl: 'https://xxx.supabase.co',
 *     supabaseKey: 'anon-key',
 *     userId:      'uuid',
 *     familyId:    'uuid',
 *     sessionToken: 'JWT-token',  // user's access token for RPC auth
 *   })
 *
 *   // Stop (call when user disables location sharing)
 *   await LocationService.stop()
 *
 *   // Check if running
 *   const { running } = await LocationService.isRunning()
 */
@CapacitorPlugin(
    name = "LocationService",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        )
    }
)
public class LocationPlugin extends Plugin {

    /**
     * Requests ACCESS_BACKGROUND_LOCATION at runtime.
     *
     * WHY THIS EXISTS: @capacitor/geolocation's requestPermissions() only asks
     * for FOREGROUND location (fine/coarse). On Android 10+ background location
     * is a SEPARATE permission that must be requested on its own — without this,
     * Android never offers the user the "Allow all the time" option, so the pin
     * freezes the moment the app is backgrounded. This method triggers that
     * second prompt (which on Android 11+ opens the system settings page where
     * the user selects "Allow all the time").
     *
     * Call this from JS AFTER foreground location is already granted.
     */
    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        // Below Android 10 there is no separate background permission — foreground covers it
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }

        if (hasBackgroundPermission()) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }

        requestPermissionForAlias("backgroundLocation", call, "backgroundPermCallback");
    }

    @PermissionCallback
    private void backgroundPermCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", hasBackgroundPermission());
        call.resolve(res);
    }

    @PluginMethod
    public void hasBackgroundPermission(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", hasBackgroundPermission());
        call.resolve(res);
    }

    private boolean hasBackgroundPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Checks whether the app is exempt from battery optimization ("Doze").
     * When NOT exempt, Android throttles/kills the background location service
     * once the app is backgrounded or swiped away — the #1 cause of location
     * stopping when the app is closed.
     */
    @PluginMethod
    public void isBatteryOptimizationIgnored(PluginCall call) {
        JSObject res = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            res.put("ignored", true);  // no Doze before Android 6
            call.resolve(res);
            return;
        }
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean ignored = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        res.put("ignored", ignored);
        call.resolve(res);
    }

    /**
     * Opens the system dialog asking the user to exempt FamilyGuard from battery
     * optimization. Required for reliable background tracking — without this the
     * OS kills the service to save power. On many OEM phones (Xiaomi, Oppo, Vivo,
     * Realme, Samsung) this is mandatory for background location to survive the
     * app being closed.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                call.resolve();  // already exempt
                return;
            }
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Some OEMs block the direct-request intent — fall back to the
            // general battery optimization settings list.
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open battery optimization settings: " + e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String supabaseUrl   = call.getString("supabaseUrl");
        String supabaseKey   = call.getString("supabaseKey");
        String userId        = call.getString("userId");
        String familyId      = call.getString("familyId");
        String sessionToken  = call.getString("sessionToken", "");
        String refreshToken  = call.getString("refreshToken", "");

        if (supabaseUrl == null || supabaseKey == null || userId == null || familyId == null) {
            call.reject("Missing required parameters: supabaseUrl, supabaseKey, userId, familyId");
            return;
        }

        // Store credentials so the service can read them even after the app is killed.
        // The refresh token lets the service renew its own session natively once the
        // access token expires, instead of freezing when the app is closed.
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(
            LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(LocationForegroundService.KEY_URL,       supabaseUrl)
            .putString(LocationForegroundService.KEY_KEY,       supabaseKey)
            .putString(LocationForegroundService.KEY_USER_ID,   userId)
            .putString(LocationForegroundService.KEY_FAMILY_ID, familyId)
            .putString(LocationForegroundService.KEY_SESSION,   sessionToken)
            .putString(LocationForegroundService.KEY_REFRESH,   refreshToken)
            .apply();

        LocationForegroundService.startService(ctx);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LocationForegroundService.stopService(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", LocationForegroundService.isRunning);
        call.resolve(result);
    }

    /**
     * Called when the user's session token refreshes — update it so the
     * running service always uses a valid JWT for Supabase RPC calls.
     * Also updates the refresh token when provided, so the service can keep
     * renewing its own session natively after the app is closed.
     */
    @PluginMethod
    public void updateSessionToken(PluginCall call) {
        String token = call.getString("sessionToken");
        if (token == null) { call.reject("sessionToken required"); return; }
        String refreshToken = call.getString("refreshToken");
        SharedPreferences.Editor editor = getContext()
            .getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(LocationForegroundService.KEY_SESSION, token);
        if (refreshToken != null) editor.putString(LocationForegroundService.KEY_REFRESH, refreshToken);
        editor.apply();
        call.resolve();
    }
}
