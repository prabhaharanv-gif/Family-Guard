package com.scoopfamily.familyguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Restarts LocationForegroundService if it has stopped without being told to.
 *
 * WHY THIS EXISTS: until now the only thing that could bring the service back
 * was onTaskRemoved (the user swiping the app from Recents) and BootReceiver (a
 * reboot). Neither covers the case that actually happens most: the OEM kills the
 * process on its own — low memory, MIUI's background cleanup, a battery
 * "optimisation" sweep. onTaskRemoved is never called for those, and START_STICKY
 * is a request the system is free to ignore, which aggressive skins routinely do.
 *
 * The result was a member whose phone looked completely healthy — sharing on,
 * GPS on, signed in, 97% battery — whose location silently stopped updating and
 * never resumed until they happened to open the app. From the family's side that
 * is indistinguishable from the app working, which is the worst property a
 * safety feature can have.
 *
 * This is a periodic backstop, not a hot loop: the alarm is inexact and fires
 * about every 15 minutes, so Android batches it with other wakeups and it costs
 * effectively nothing. It does no work at all when the service is already up,
 * which is the normal case.
 *
 * What it deliberately does NOT do is override the user's choices.
 * startService() makes its own checks — location permission, and the member's
 * sharing preference — so a member who turned sharing off stays off, and the
 * alarm is cancelled outright whenever something stops the service on purpose.
 *
 * The one kill it cannot survive is a force-stop (MIUI's "close app" from
 * Settings, or swiping in some skins), which cancels the app's alarms as well.
 * Nothing short of the user opening the app recovers from that; it is a platform
 * rule, not something to work around.
 */
public class ServiceWatchdogReceiver extends BroadcastReceiver {

    private static final String TAG = "FG_Watchdog";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (LocationForegroundService.isRunning) {
            // Normal case. Say nothing and do nothing.
            return;
        }

        Log.w(TAG, "Location service is not running — restarting it");
        // startService applies the permission and sharing checks, and swallows a
        // refusal rather than throwing out of a receiver.
        LocationForegroundService.startService(context);
    }
}
