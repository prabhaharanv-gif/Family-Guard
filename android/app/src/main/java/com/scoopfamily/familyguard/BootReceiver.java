package com.scoopfamily.familyguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * BootReceiver
 *
 * Restarts the LocationForegroundService after the device reboots.
 * Without this, the background location service dies on reboot and
 * family members' pins go stale until they manually reopen the app.
 *
 * Requires RECEIVE_BOOT_COMPLETED permission (already in manifest).
 * The service will only restart if the user had previously started it
 * (i.e. they were logged in and tracking was active).
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) &&
            !"android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {
            return;
        }

        Log.i(TAG, "Boot completed — checking if location service should restart");

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

        Log.i(TAG, "Restarting LocationForegroundService after boot");
        LocationForegroundService.startService(context);
    }
}
