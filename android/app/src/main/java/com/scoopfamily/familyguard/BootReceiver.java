package com.scoopfamily.familyguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * BootReceiver
 *
 * Restarts the LocationForegroundService after the two events that otherwise
 * leave the app silently unprotected:
 *
 *   · a device reboot — without this the background service dies and family
 *     members' pins go stale until someone reopens the app;
 *   · an app UPDATE. Installing a new version stops the process, and nothing
 *     started it again: location sharing, shake SOS and the fake-call button
 *     all stayed off until the person next opened the app, which can be days
 *     after a Play Store update. It cost several rounds of device testing here
 *     before it was noticed, and a tester would never notice at all.
 *
 * Both broadcasts are on the platform's exemption list, so the foreground
 * service may be started from them even on Android 12+.
 *
 * The service only restarts if the person was signed in and had tracking on:
 * startService() re-checks the sharing preference and the location permission.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        boolean booted  = Intent.ACTION_BOOT_COMPLETED.equals(action)
                       || "android.intent.action.QUICKBOOT_POWERON".equals(action);
        boolean updated = Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (!booted && !updated) return;

        Log.i(TAG, (updated ? "App updated" : "Boot completed")
                 + " — checking if location service should restart");

        // Only restart if we have saved credentials (user was logged in)
        SharedPreferences prefs = context.getSharedPreferences(
            LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE
        );
        String userId   = prefs.getString(LocationForegroundService.KEY_USER_ID, null);
        String familyId = prefs.getString(LocationForegroundService.KEY_FAMILY_ID, null);
        String url      = prefs.getString(LocationForegroundService.KEY_URL, null);

        if (userId == null || familyId == null || url == null) {
            Log.i(TAG, "No saved session — skipping service restart");
            return;
        }

        // Location permission can be revoked between one boot and the next, and
        // starting a location-typed foreground service without it kills the
        // whole process rather than just failing. Go through startService(),
        // which makes that check in one place for every start path.
        if (!LocationForegroundService.hasLocationPermission(context)) {
            Log.i(TAG, "Location permission not granted — skipping service restart");
            return;
        }

        Log.i(TAG, "Restarting LocationForegroundService after " + (updated ? "update" : "boot"));
        LocationForegroundService.startService(context);
    }
}
