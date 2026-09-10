package com.scoopfamily.familyguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * The way back from an SOS raised by accident.
 *
 * Three power presses is a low bar and a phone loose in a pocket can clear it,
 * so every native send posts a notification with a Cancel action pointing here.
 * Cancelling calls resolve_sos — the same thing "I'm Safe" does in the app —
 * which means a mistake can be taken back from the lock screen rather than by
 * unlocking the phone and finding the SOS screen.
 *
 * The alert still reaches the family either way. Nothing can unsend it; what
 * this buys is the difference between "they saw an SOS and then saw it
 * resolved seconds later" and "they are still calling at 3am".
 */
public class SosCancelReceiver extends BroadcastReceiver {

    private static final String TAG = "SOS_Native";

    static final String ACTION_CANCEL = "com.scoopfamily.familyguard.CANCEL_SOS";
    static final String EXTRA_SOS_ID  = "sos_id";

    /** Its own channel: the alert channels carry a siren, and this is a receipt. */
    private static final String CHANNEL_ID = "sos_sent_v1";
    private static final int    NOTIF_ID   = 4801;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_CANCEL.equals(intent.getAction())) return;

        final String sosId = intent.getStringExtra(EXTRA_SOS_ID);
        final Context ctx  = context.getApplicationContext();

        // Take the notification away immediately. Whether the RPC succeeds or
        // the phone is offline, the user has said what they meant, and leaving
        // a Cancel button that appears to do nothing is worse than either
        // outcome.
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                boolean ok = SosSender.resolve(ctx, sosId);
                Log.i(TAG, ok ? "Accidental SOS withdrawn" : "Could not withdraw the SOS");
            } finally {
                pending.finish();
            }
        }, "sos-cancel").start();
    }

    /**
     * Posts the "SOS sent" receipt carrying the Cancel action.
     *
     * @param sosId null when the send failed, in which case the notification
     *              says so and carries no Cancel — there is nothing to undo.
     */
    static void showSent(Context ctx, String sosId) {
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "SOS sent", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Confirms an SOS you raised, and lets you cancel it");
            // Silent on purpose: the gesture already vibrates, and the phone is
            // usually in a pocket. A second noise here adds nothing and would
            // sound like the incoming-alert siren, which this is not.
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        }

        boolean sent = sosId != null;

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(sent ? "SOS sent to your family" : "SOS could not be sent")
            .setContentText(sent
                ? "Tap Cancel if you did not mean to send this."
                : "No connection. Open the app to try again.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(false)
            .setAutoCancel(true)
            // Readable from the lock screen: someone who has just triggered
            // this by accident should not have to unlock to undo it.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (sent) {
            Intent cancel = new Intent(ctx, SosCancelReceiver.class)
                .setAction(ACTION_CANCEL)
                .putExtra(EXTRA_SOS_ID, sosId);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, sosId.hashCode(), cancel, flags);

            b.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_menu_close_clear_cancel, "Cancel — I'm safe", pi));
        }

        try {
            nm.notify(NOTIF_ID, b.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused on Android 13+. The alert still went
            // out; only the receipt is lost.
            Log.w(TAG, "Could not post the SOS receipt: " + e.getMessage());
        }
    }
}
