package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * "Phone lost" mode, on the phone that was marked lost.
 *
 * Started by a push (MyFirebaseMessagingService) after a family admin or the
 * owner used the member card, stopped by another push, by expiry, or here.
 * While active:
 *  - LocationForegroundService reports every LostModePlan.PUSH_EVERY_MS and runs
 *    at its fast cadence (it asks isActive on every fix);
 *  - tick(), called on every fix, rings the phone every RING_EVERY_MS by reusing
 *    the Find-my-phone ring (PingRingService);
 *  - an ongoing notification carries the message on the lock screen.
 *
 * State lives in the same SharedPreferences as the location service, so a
 * restart of the service or the process does not lose lost mode.
 *
 * The owner opted in server-side (allow_lost_mode) before anyone could start
 * this; the deadline is capped at 12 hours whatever the server says.
 */
final class LostPhone {

    private static final String TAG = "LostPhone";

    static final String KEY_UNTIL     = "lost_until_ms";
    static final String KEY_MESSAGE   = "lost_message";
    static final String KEY_STARTER   = "lost_starter";
    static final String KEY_LAST_RING = "lost_last_ring_ms";

    private static final String CHANNEL_ID = "lost_phone_v1";
    private static final int    NOTIF_ID   = 9315;

    private LostPhone() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
    }

    static boolean isActive(Context ctx) {
        try {
            return LostModePlan.active(System.currentTimeMillis(), prefs(ctx).getLong(KEY_UNTIL, 0L));
        } catch (Exception e) {
            return false;
        }
    }

    /** From the push. untilSec is the server deadline in epoch seconds, or 0. */
    static void start(Context ctx, String message, String starter, long untilSec) {
        long now = System.currentTimeMillis();
        long until = LostModePlan.deadline(now, untilSec * 1000L);
        prefs(ctx).edit()
            .putLong(KEY_UNTIL, until)
            .putString(KEY_MESSAGE, message == null ? "" : message)
            .putString(KEY_STARTER, starter == null ? "" : starter)
            .putLong(KEY_LAST_RING, 0L)          // ring on the very next tick
            .commit();
        Log.w(TAG, "LOST MODE ON until " + new java.util.Date(until));
        postNotification(ctx);
        // Make sure the location service is running to report; it also drives tick().
        if (LocationForegroundService.hasLocationPermission(ctx) && !LocationForegroundService.isRunning) {
            try { LocationForegroundService.startService(ctx); } catch (Exception e) {
                Log.w(TAG, "could not start the location service: " + e.getMessage());
            }
        }
        tick(ctx);
    }

    static void stop(Context ctx) {
        SharedPreferences p = prefs(ctx);
        boolean was = p.getLong(KEY_UNTIL, 0L) > 0L;
        p.edit().remove(KEY_UNTIL).remove(KEY_MESSAGE).remove(KEY_STARTER).remove(KEY_LAST_RING).commit();
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {}
        try { PingRingService.stopService(ctx); } catch (Exception ignored) {}
        if (was) Log.w(TAG, "LOST MODE OFF");
    }

    /** Called on every location fix: ends lost mode at its deadline, rings when due. */
    static void tick(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            long until = p.getLong(KEY_UNTIL, 0L);
            if (until <= 0L) return;
            long now = System.currentTimeMillis();
            if (!LostModePlan.active(now, until)) { stop(ctx); return; }
            if (LostModePlan.shouldRing(now, until, p.getLong(KEY_LAST_RING, 0L))) {
                p.edit().putLong(KEY_LAST_RING, now).commit();
                ring(ctx);
                // Re-post so the message is back on the lock screen if it was swiped away.
                postNotification(ctx);
            }
        } catch (Exception e) {
            Log.w(TAG, "tick failed: " + e.getMessage());
        }
    }

    private static void ring(Context ctx) {
        try {
            PingRingService.ensurePingChannelStatic(ctx);
            Intent i = new Intent(ctx, PingRingService.class);
            i.putExtra("sender", prefs(ctx).getString(KEY_STARTER, ""));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
            Log.i(TAG, "ringing");
        } catch (Exception e) {
            Log.w(TAG, "could not ring: " + e.getMessage());
        }
    }

    private static void postNotification(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    ctx.getString(R.string.ch_lost_name), NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription(ctx.getString(R.string.ch_lost_desc));
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
            SharedPreferences p = prefs(ctx);
            String msg = p.getString(KEY_MESSAGE, "");
            String starter = p.getString(KEY_STARTER, "");
            String body = !msg.isEmpty() ? msg
                : !starter.isEmpty() ? ctx.getString(R.string.lost_body_default, starter)
                : ctx.getString(R.string.lost_body_generic);

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(ctx, 919, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(ctx.getString(R.string.lost_title))
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                // PUBLIC: the whole point is that a finder can read it on the lock screen.
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
            nm.notify(NOTIF_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "could not post the lost-phone notification: " + e.getMessage());
        }
    }
}
