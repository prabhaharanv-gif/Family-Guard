package com.scoopfamily.familyguard;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.Locale;

/**
 * The "I can help" / "No thanks" actions on a NearbyHelpRingService
 * notification.
 *
 * Modeled directly on SosCancelReceiver: goAsync() + a background thread, so
 * the RPC call still completes even when this broadcast is all that is
 * running — the notification outlives the service that posted it (see
 * NearbyHelpRingService's onDestroy), and the app process may otherwise be
 * idle by the time someone taps a button.
 *
 * ACCEPT reveals real coordinates and offers exactly two actions on success:
 * dial 112 and view the location in Maps. Nothing else — no navigation
 * intent, no way to contact the sender directly. That is a deliberate safety
 * boundary from the plan (an earlier "dispatch a stranger" design was
 * explicitly rejected), not an oversight to extend later.
 */
public class NearbyHelpActionReceiver extends BroadcastReceiver {

    private static final String TAG = "FamoraNearbyHelp";

    static final String ACTION_ACCEPT  = "com.scoopfamily.familyguard.NEARBY_HELP_ACCEPT";
    static final String ACTION_DECLINE = "com.scoopfamily.familyguard.NEARBY_HELP_DECLINE";

    static final String EXTRA_NOTIFICATION_ID = "notification_id";
    static final String EXTRA_ESCALATION_ID   = "escalation_id";
    static final String EXTRA_HELP_KIND       = "help_kind";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        final Context ctx = context.getApplicationContext();
        final String notificationId = intent.getStringExtra(EXTRA_NOTIFICATION_ID);
        final String escalationId   = intent.getStringExtra(EXTRA_ESCALATION_ID);
        final String helpKind       = intent.getStringExtra(EXTRA_HELP_KIND);

        if (notificationId == null || notificationId.isEmpty()) {
            Log.w(TAG, "Ignoring " + action + " — no notification id attached");
            return;
        }

        // Responding, either way, stops the ring/vibration immediately rather
        // than waiting out the rest of the 45s window.
        NearbyHelpRingService.stopService(ctx);

        if (ACTION_ACCEPT.equals(action)) {
            final PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    handleAccept(ctx, notificationId, escalationId, helpKind);
                } finally {
                    pending.finish();
                }
            }, "nearby-help-accept").start();

        } else if (ACTION_DECLINE.equals(action)) {
            final PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    boolean ok = NearbyHelpSender.decline(ctx, notificationId);
                    Log.i(TAG, ok ? "Declined a nearby-help request" : "Could not record the decline");
                } finally {
                    NearbyHelpRingService.cancelNotification(ctx, notificationId);
                    pending.finish();
                }
            }, "nearby-help-decline").start();
        }
    }

    private void handleAccept(Context ctx, String notificationId, String escalationId, String helpKind) {
        boolean accepted = NearbyHelpSender.accept(ctx, notificationId);
        double[] loc = (accepted && escalationId != null && !escalationId.isEmpty())
            ? NearbyHelpSender.getLocation(ctx, escalationId)
            : null;

        if (!accepted || loc == null) {
            // Either the accept itself lost the race (escalation no longer
            // 'searching'), or it succeeded but the reveal came back with zero
            // rows — both mean someone else got there first. Same fallback
            // either way; never crash or leave a broken action button.
            Log.i(TAG, "Nearby-help accept could not be completed for " + notificationId
                     + " (accepted=" + accepted + ", loc=" + (loc != null) + ")");
            showAlreadyHandled(ctx, notificationId);
            return;
        }

        Log.i(TAG, "Nearby-help accepted — location revealed for " + notificationId);
        showRevealedLocation(ctx, notificationId, loc[0], loc[1], helpKind);
    }

    // ── Post-response notification states ────────────────────────────────────

    private void showAlreadyHandled(Context ctx, String notificationId) {
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NearbyHelpRingService.ensureNearbyHelpChannelStatic(ctx);

        String body = ctx.getString(R.string.notif_nearby_help_already_body);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, NearbyHelpRingService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#4A5A6A"))
            .setContentTitle(ctx.getString(R.string.notif_nearby_help_already_title))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(false)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true);

        post(nm, notificationId, b);
    }

    private void showRevealedLocation(Context ctx, String notificationId, double lat, double lng, String helpKind) {
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NearbyHelpRingService.ensureNearbyHelpChannelStatic(ctx);

        int id = NearbyHelpRingService.notifId(notificationId);
        String coords = String.format(Locale.US, "%.5f, %.5f", lat, lng);

        // ACTION_DIAL, not ACTION_CALL: matches every other tel: touchpoint in
        // this app (see SOSAlertActivity) — needs no CALL_PHONE permission,
        // and the confirming tap in the dialler is a deliberate last check
        // before a call actually goes out.
        Intent dialIntent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + NearbyHelpKind.number(helpKind)));
        dialIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent dialPi = PendingIntent.getActivity(
            ctx, id ^ 3, dialIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // A static "view" intent only — no turn-by-turn/"directions to". This
        // is the hard safety boundary from the plan: the only actions an
        // accepted helper ever gets are dial 112 and look at a map, never
        // navigate toward the sender.
        Intent mapIntent = new Intent(Intent.ACTION_VIEW,
            Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng));
        mapIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent mapPi = PendingIntent.getActivity(
            ctx, id ^ 4, mapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String body = ctx.getString(R.string.notif_nearby_help_accepted_body, coords, NearbyHelpKind.number(helpKind));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, NearbyHelpRingService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#4A5A6A"))
            .setContentTitle(ctx.getString(R.string.notif_nearby_help_accepted_title))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(false)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .addAction(0, ctx.getString(R.string.notif_action_call_number, NearbyHelpKind.number(helpKind)), dialPi)
            .addAction(0, ctx.getString(R.string.notif_action_open_maps), mapPi);

        post(nm, notificationId, b);
    }

    private static void post(NotificationManager nm, String notificationId, NotificationCompat.Builder b) {
        try {
            nm.notify(NearbyHelpRingService.notifId(notificationId), b.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused on Android 13+. The RPC call itself
            // already went through; only the on-screen confirmation is lost.
            Log.w(TAG, "Could not post the nearby-help response notification: " + e.getMessage());
        }
    }
}
