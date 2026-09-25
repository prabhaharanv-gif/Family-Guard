package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Posts the notification that asks THIS phone's owner — a bystander, not the
 * person in danger — to consider calling 112 for someone nearby.
 *
 * Not a foreground service, despite the class name kept for continuity with
 * the plan and with NearbyHelpActionReceiver's calls into it. PingRingService
 * and SOSSirenService need a foreground service because they keep a
 * synthesized AudioTrack looping for the ring's duration, which requires a
 * live process the OS will not kill mid-playback. This has no continuous
 * work: the notification channel fires its own sound and vibration once,
 * automatically, the moment notify() posts it (see
 * ensureNearbyHelpChannelStatic()), and then just sits in the shade with its
 * two actions until the user responds or a standdown/cancel arrives. A
 * foreground service (and the FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK that
 * would come with it, for media that never actually plays) would be
 * unearned complexity and a mismatch Play Store review can flag — so this
 * stays a plain static call, same as showSosNotification()'s fallback path
 * in MyFirebaseMessagingService.
 */
public class NearbyHelpRingService {

    private static final String TAG = "FamoraNearbyHelp";

    public static final String CHANNEL_ID = "nearby_help_v1";

    private static final int FOREGROUND_ID_FALLBACK = 9411;

    // What this device is currently showing a nearby-help notification for —
    // used by standDown() to decide whether a standdown/cancelled push
    // applies to what is on screen, and to find it to cancel. In-memory only:
    // a process restart forgets it, and a stale notification (if any
    // survives one) just fails gracefully through the "already handled" path
    // in NearbyHelpActionReceiver instead of being actively cancelled.
    private static volatile String currentNotificationId = null;
    private static volatile String currentEscalationId   = null;

    private NearbyHelpRingService() {}

    /** Builds and posts the bystander-facing request. Safe to call repeatedly. */
    public static void show(Context ctx, String notificationId, String escalationId,
                             String tier, String fuzzyLat, String fuzzyLng, String fuzzyRadiusM, String helpKind) {
        if (notificationId == null) notificationId = "";
        if (escalationId   == null) escalationId   = "";

        currentNotificationId = notificationId;
        currentEscalationId   = escalationId;

        ensureNearbyHelpChannelStatic(ctx);

        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        try {
            nm.notify(notifId(notificationId), buildNotification(ctx, notificationId, escalationId, fuzzyRadiusM, helpKind));
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused on Android 13+ — nothing further to do.
            Log.w(TAG, "Could not post the nearby-help request notification: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Notification — BigTextStyle, "I can help" / "No thanks"
    // ─────────────────────────────────────────────────────────────────────────
    private static Notification buildNotification(Context ctx, String notificationId, String escalationId,
                                                    String fuzzyRadiusM, String helpKind) {
        String radiusLabel = formatRadius(fuzzyRadiusM);
        String body    = ctx.getString(R.string.notif_nearby_help_body, radiusLabel,
            ctx.getString(NearbyHelpKind.needRes(helpKind)), NearbyHelpKind.number(helpKind));
        String bigText = body + "\n\n" + ctx.getString(R.string.notif_nearby_help_note);

        int id = notifId(notificationId);

        Intent acceptIntent = new Intent(ctx, NearbyHelpActionReceiver.class)
            .setAction(NearbyHelpActionReceiver.ACTION_ACCEPT)
            .putExtra(NearbyHelpActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            .putExtra(NearbyHelpActionReceiver.EXTRA_ESCALATION_ID,   escalationId)
            .putExtra(NearbyHelpActionReceiver.EXTRA_HELP_KIND,       helpKind);
        PendingIntent acceptPi = PendingIntent.getBroadcast(
            ctx, id ^ 1, acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent declineIntent = new Intent(ctx, NearbyHelpActionReceiver.class)
            .setAction(NearbyHelpActionReceiver.ACTION_DECLINE)
            .putExtra(NearbyHelpActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            .putExtra(NearbyHelpActionReceiver.EXTRA_ESCALATION_ID,   escalationId)
            .putExtra(NearbyHelpActionReceiver.EXTRA_HELP_KIND,       helpKind);
        PendingIntent declinePi = PendingIntent.getBroadcast(
            ctx, id ^ 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
            ctx, id, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            // Neutral slate, not the SOS crimson or the brand maroon — this is
            // not the family's own emergency and must never read as one.
            .setColor(android.graphics.Color.parseColor("#4A5A6A"))
            .setContentTitle(ctx.getString(R.string.notif_nearby_help_title))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(false)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentPi)
            .addAction(0, ctx.getString(R.string.notif_action_help),      acceptPi)
            .addAction(0, ctx.getString(R.string.notif_action_no_thanks), declinePi)
            .build();
    }

    private static String formatRadius(String radiusM) {
        try {
            int m = Integer.parseInt(radiusM.trim());
            return m + " m";
        } catch (Exception e) {
            return "a few hundred metres";
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Notification channel — sound + vibration live on the CHANNEL, since
    //  this posts one notification and does not synthesize its own audio.
    //  IMPORTANCE_HIGH for the heads-up banner, but deliberately no
    //  setBypassDnd(true): unlike the SOS/Ping channels, a bystander request
    //  is not the recipient's own emergency, so their Do Not Disturb choice
    //  is respected.
    // ─────────────────────────────────────────────────────────────────────────
    public static void ensureNearbyHelpChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (nm.getNotificationChannel(CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, CHANNEL_ID,
                R.string.ch_nearby_help_name, R.string.ch_nearby_help_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, ctx.getString(R.string.ch_nearby_help_name),
            NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(ctx.getString(R.string.ch_nearby_help_desc));
        ch.enableVibration(true);
        // Short and gentle on purpose — this must read as noticeably less
        // alarming than both the SOS morse pattern and the Ping double-buzz,
        // so it is never confused with either.
        ch.setVibrationPattern(new long[]{0, 200, 150, 200});
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Static helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** One notification id per notification_id, so callers can update or
     *  cancel exactly the one this posted without any shared service state. */
    public static int notifId(String notificationId) {
        if (notificationId == null || notificationId.isEmpty()) return FOREGROUND_ID_FALLBACK;
        return notificationId.hashCode();
    }

    /** Cancels whatever notification this id maps to. Safe if none is showing. */
    public static void cancelNotification(Context ctx, String notificationId) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(notifId(notificationId));
        } catch (Exception ignored) {}
    }

    /**
     * Called when the user responds locally (accept/decline), so the tracked
     * "what is currently showing" state is cleared immediately rather than
     * waiting for a standdown push that may never need to arrive.
     */
    public static void stopService(Context context) {
        currentNotificationId = null;
        currentEscalationId   = null;
    }

    /**
     * nearby_help_standdown ("someone else already accepted") and
     * nearby_help_cancelled ("the SOS was resolved") land here.
     *
     * Only acts when the escalation matches the one this device is currently
     * showing a notification for — an id mismatch means this push is about a
     * different notification than whatever is on screen, and nothing here
     * should be touched.
     */
    public static void standDown(Context ctx, String escalationId) {
        if (ctx == null) return;
        final Context appCtx = ctx.getApplicationContext();

        String trackedEscalation   = currentEscalationId;
        String trackedNotification = currentNotificationId;

        if (escalationId != null && !escalationId.isEmpty()
                && trackedEscalation != null && !escalationId.equals(trackedEscalation)) {
            return;
        }

        if (trackedNotification != null && !trackedNotification.isEmpty()) {
            cancelNotification(appCtx, trackedNotification);
        }

        currentNotificationId = null;
        currentEscalationId   = null;
    }
}
