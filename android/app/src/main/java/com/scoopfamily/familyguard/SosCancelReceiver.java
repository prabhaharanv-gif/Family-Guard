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
 * The two ways back from an SOS raised by accident.
 *
 * Before it is sent — ACTION_ABORT
 *   A recognised SOS gesture arms a send and starts a three-second countdown;
 *   this
 *   stops it. Nothing has left the phone, so there is nothing to withdraw and
 *   no one to wake. This is the one that actually costs nothing.
 *
 * After it is sent — ACTION_CANCEL
 *   The grace window can be missed, notably when the phone is in a pocket and
 *   the buzz goes unfelt, so every native send also posts a receipt carrying
 *   Cancel. Cancelling calls resolve_sos — the same thing "I'm Safe" does in
 *   the app — which means a mistake can be taken back from the lock screen
 *   rather than by unlocking the phone and finding the SOS screen. The alert
 *   still reached the family; nothing can unsend it. What this buys is the
 *   difference between "they saw an SOS and then saw it resolved seconds
 *   later" and "they are still calling at 3am".
 */
public class SosCancelReceiver extends BroadcastReceiver {

    private static final String TAG = "SOS_Native";

    static final String ACTION_CANCEL = "com.scoopfamily.familyguard.CANCEL_SOS";
    static final String ACTION_ABORT  = "com.scoopfamily.familyguard.ABORT_SOS";
    static final String EXTRA_SOS_ID  = "sos_id";

    /** Its own channel: the alert channels carry a siren, and this is a receipt. */
    private static final String CHANNEL_ID = "sos_sent_v1";
    /** One id for the whole life of one SOS, so the countdown, the "sending"
     *  state and the receipt replace each other instead of stacking up. */
    private static final int    NOTIF_ID   = 4801;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        final Context ctx = context.getApplicationContext();

        // Stop a send that has not happened yet. Nothing to undo afterwards,
        // so this returns without touching the network at all.
        if (ACTION_ABORT.equals(action)) {
            if (!SosArming.abortPending(ctx)) {
                // The countdown ran out between the tap and this broadcast.
                // The receipt with its own Cancel is on its way; leave it be.
                Log.i(TAG, "Abort arrived after the send started — the receipt's Cancel applies now");
            }
            return;
        }

        if (!ACTION_CANCEL.equals(action)) return;

        final String sosId = intent.getStringExtra(EXTRA_SOS_ID);

        // Take the notification away immediately. Whether the RPC succeeds or
        // the phone is offline, the user has said what they meant, and leaving
        // a Cancel button that appears to do nothing is worse than either
        // outcome.
        dismiss(ctx);

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
     * The countdown shown while the send is armed, carrying the action that
     * stops it. Re-posted each second; setOnlyAlertOnce keeps the ticking from
     * re-announcing itself three times over.
     */
    static void showCountdown(Context ctx, int secondsLeft) {
        NotificationManager nm = ensureChannel(ctx);
        if (nm == null) return;

        Intent abort = new Intent(ctx, SosCancelReceiver.class).setAction(ACTION_ABORT);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, abort, pendingIntentFlags());

        NotificationCompat.Builder b = base(ctx)
            .setContentTitle("Sending SOS in " + secondsLeft + "s")
            .setContentText("Tap Cancel if you did not mean to do this.")
            .setOnlyAlertOnce(true)
            // Not swipeable: dismissing it by accident would leave the send
            // running with no way to reach the Cancel action.
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(new NotificationCompat.Action(
                android.R.drawable.ic_menu_close_clear_cancel, "Cancel", pi));

        post(nm, b);
    }

    /**
     * Replaces the countdown once the grace window has run out. No Cancel: the
     * request is on the wire, and the receipt that follows carries the action
     * that can actually withdraw it.
     */
    static void showSending(Context ctx) {
        NotificationManager nm = ensureChannel(ctx);
        if (nm == null) return;

        post(nm, base(ctx)
            .setContentTitle("Sending SOS to your family")
            .setContentText("Alerting everyone now.")
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false));
    }

    /**
     * Posts the "SOS sent" receipt carrying the Cancel action.
     *
     * @param sosId null when the send failed, in which case the notification
     *              says so and carries no Cancel — there is nothing to undo.
     */
    static void showSent(Context ctx, String sosId) {
        NotificationManager nm = ensureChannel(ctx);
        if (nm == null) return;

        boolean sent = sosId != null;

        NotificationCompat.Builder b = base(ctx)
            .setContentTitle(sent ? "SOS sent to your family" : "SOS could not be sent")
            .setContentText(sent
                ? "Tap Cancel if you did not mean to send this."
                : "No connection. Open the app to try again.")
            .setOngoing(false)
            .setAutoCancel(true);

        if (sent) {
            Intent cancel = new Intent(ctx, SosCancelReceiver.class)
                .setAction(ACTION_CANCEL)
                .putExtra(EXTRA_SOS_ID, sosId);

            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, sosId.hashCode(), cancel, pendingIntentFlags());

            b.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_menu_close_clear_cancel, "Cancel — I'm safe", pi));
        }

        post(nm, b);
    }

    /** Takes the notification away, whatever stage it is showing. */
    static void dismiss(Context ctx) {
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
    }

    /** Everything the three stages share. */
    private static NotificationCompat.Builder base(Context ctx) {
        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            // Readable from the lock screen: someone who has just triggered
            // this by accident should not have to unlock to stop or undo it.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    }

    private static NotificationManager ensureChannel(Context ctx) {
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return null;

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
        return nm;
    }

    private static int pendingIntentFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private static void post(NotificationManager nm, NotificationCompat.Builder b) {
        try {
            nm.notify(NOTIF_ID, b.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused on Android 13+. The gesture still
            // works and the alert still goes out; only the receipt is lost.
            Log.w(TAG, "Could not post the SOS notification: " + e.getMessage());
        }
    }
}
