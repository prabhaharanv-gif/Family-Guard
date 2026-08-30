package com.scoopfamily.familyguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Handles FCM messages when the app is alive (foreground or background).
 *
 * When app is KILLED:
 *   FCM hybrid message → Android shows the notification automatically using
 *   the sos_alerts_v3 channel's alarm sound. onMessageReceived() is NOT called.
 *
 * When app is ALIVE (foreground or background):
 *   onMessageReceived() IS called.
 *
 * Fix for double sound + unwanted banner:
 *   The app sets a shared preference "messages_page_open" = true when the
 *   Messages page is visible, and false when it's not. We check this flag
 *   before posting a notification or playing a sound — if the user is already
 *   on the Messages page, we skip both entirely (the realtime channel already
 *   shows the message live in the UI).
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {

    // v4: the channel used to carry the device's default ALARM ringtone, which
    // played on top of SOSSirenService's synthesized siren — two different
    // sounds for one alert. A channel's sound cannot be changed after creation,
    // so the id is bumped to force a silent one on existing installs.
    public  static final String SOS_CHANNEL_ID   = "sos_alerts_v4";
    private static final String SOS_CHANNEL_NAME = "SOS Emergency Alerts";
    public  static final int    SOS_NOTIFICATION_ID = 911;

    // Audible channel for the FCM `notification` block on an incoming call.
    // When the app is CLOSED, Android displays that block itself and rings
    // using THIS channel's sound — our CallRingingService (which owns the
    // ringtone while the app is alive) never runs. CallRingingService's own
    // channel is deliberately silent so the two don't double-ring, which left
    // closed-app calls arriving with no sound at all until this was split out.
    // Mirrors the sos_alerts_v3 (audible push) + sos_popup_v1 (silent service)
    // pairing that makes SOS work from a closed app.
    public  static final String CALL_CHANNEL_ID   = "incoming_calls_ring_v1";
    private static final String CALL_CHANNEL_NAME = "Incoming Calls";

    private static final String MSG_CHANNEL_ID   = "family_messages_v3";
    private static final String MSG_CHANNEL_NAME = "Family Messages";
    // Silent channel — banner shows but no sound (used for mute level 1)
    private static final String MSG_SILENT_CHANNEL_ID   = "family_messages_silent";
    private static final String MSG_SILENT_CHANNEL_NAME = "Family Messages (Silent)";

    // Shared preference key written by MainActivity when Messages page is open
    public static final String PREF_NAME          = "fg_prefs";
    public static final String KEY_MESSAGES_OPEN  = "messages_page_open";
    // 0 = all on, 1 = sound muted, 2 = sound + banner fully muted
    public static final String KEY_MUTE_LEVEL     = "msg_mute_level";

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        Log.d("FamoraCall", "onMessageReceived: type=" + type + " data=" + data);

        Context appCtx = getApplicationContext();

        if ("sos".equals(type)) {
            String sender  = data.containsKey("sender")  ? data.get("sender")  : "A family member";
            String message = data.containsKey("message") ? data.get("message") : "SOS Alert";
            String lat     = data.containsKey("lat") ? data.get("lat") : "";
            String lng     = data.containsKey("lng") ? data.get("lng") : "";

            ensureSosChannelStatic(appCtx);

            // Start the siren foreground service (audio + vibration)
            Intent sirenIntent = new Intent(appCtx, SOSSirenService.class);
            sirenIntent.putExtra("sender",  sender);
            sirenIntent.putExtra("message", message);
            sirenIntent.putExtra("lat",     lat);
            sirenIntent.putExtra("lng",     lng);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(sirenIntent);
            } else {
                appCtx.startService(sirenIntent);
            }

            // No heads-up banner. SOSAlertActivity is the SOS alert in every
            // state, and this posted a second announcement of the same emergency
            // on top of it.
            //
            // Removing it does not affect the full-screen alert: this
            // notification carries no full-screen intent. The Activity is
            // launched by SOSSirenService — its foreground notification's
            // setFullScreenIntent, plus a direct launchAlertActivity() call as a
            // fallback — neither of which is touched here.
            //
            // showSosNotification() itself is left in place; the shade entry
            // from SOSSirenService's own notification remains, so a user who
            // misses the Activity still has something to tap.

        } else if ("call".equals(type)) {
            String callId     = data.containsKey("call_id")     ? data.get("call_id")     : "";
            String callerName = data.containsKey("caller_name") ? data.get("caller_name") : "A family member";
            String callType   = data.containsKey("call_type")   ? data.get("call_type")   : "voice";

            Log.d("FamoraCall", "onMessageReceived: starting CallRingingService for call " + callId);
            CallRingingService.ensureCallRingChannelStatic(appCtx);

            // Same shape as the SOS branch — start the foreground ringing service,
            // which builds its own notification (on incoming_calls_v1, shared with
            // the FCM notification block's channel so alive/killed states look
            // identical) and full-screen intent to CallRingingActivity.
            //
            // FCM data messages reach onMessageReceived() whenever the app
            // PROCESS is alive — foreground included, not just backgrounded/
            // killed. That means the Realtime websocket path
            // (useCallSignaling.js -> CallAlarmPlugin) and this FCM path can
            // BOTH fire for the same call, ~hundreds of ms apart, in either
            // order depending on network timing — confirmed via device logs
            // racing and restarting the ringtone mid-playback (killing the
            // audio). launch_activity is computed from the same authoritative
            // MainActivity.isAppInForeground flag on both paths (not from
            // which one wins the race) so they agree regardless of order;
            // CallRingingService.isRunning below makes whichever arrives
            // second a no-op instead of re-triggering the ring.
            Intent ringIntent = new Intent(appCtx, CallRingingService.class);
            ringIntent.putExtra("call_id",     callId);
            ringIntent.putExtra("caller_name", callerName);
            ringIntent.putExtra("call_type",   callType);
            ringIntent.putExtra("caller_avatar", data.containsKey("caller_avatar") ? data.get("caller_avatar") : "");
            ringIntent.putExtra("launch_activity", !MainActivity.isAppInForeground);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    appCtx.startForegroundService(ringIntent);
                } else {
                    appCtx.startService(ringIntent);
                }
            } catch (Exception e) {
                Log.e("FamoraCall", "Failed to start CallRingingService", e);
            }

        } else if ("ping".equals(type)) {
            String sender = data.containsKey("sender") ? data.get("sender") : "A family member";

            Log.d("FamoraCall", "onMessageReceived: starting PingRingService");
            PingRingService.ensurePingChannelStatic(appCtx);

            // Same shape as the SOS branch — the foreground service owns the
            // audio, vibration and its own heads-up notification, so there is
            // nothing else to post here.
            Intent ringIntent = new Intent(appCtx, PingRingService.class);
            ringIntent.putExtra("sender", sender);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(ringIntent);
            } else {
                appCtx.startService(ringIntent);
            }

        } else if ("message".equals(type)) {
            android.content.SharedPreferences prefs = appCtx
                .getSharedPreferences(PREF_NAME, android.content.Context.MODE_PRIVATE);

            // If Messages page is open — skip entirely (realtime channel handles it)
            boolean messagesPageOpen = prefs.getBoolean(KEY_MESSAGES_OPEN, false);
            if (messagesPageOpen) return;

            // Respect mute level set by the user in the app
            // 0 = all on, 1 = sound muted, 2 = fully muted (no banner, no sound)
            int muteLevel = prefs.getInt(KEY_MUTE_LEVEL, 0);
            if (muteLevel >= 2) return; // fully muted — drop notification entirely

            String sender  = data.containsKey("sender")  ? data.get("sender")  : "Family";
            String content = data.containsKey("content") ? data.get("content") : "New message";
            showMessageNotification(appCtx, sender, content, muteLevel);
        }
    }

    // ── SOS heads-up notification ─────────────────────────────────────────────
    // Posted from onMessageReceived() alongside the siren service.
    // Uses the sos_alerts_v3 channel (alarm sound + bypass DND + max priority)
    // so MIUI shows it on the lock screen. Tapping opens MainActivity → /sos.
    public static void showSosNotification(Context ctx, String sender, String message,
                                            String lat, String lng) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // Tap intent — opens MainActivity and signals it to route to /sos
            Intent tapIntent = new Intent(ctx, MainActivity.class);
            tapIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            tapIntent.putExtra("sos_notification", true);
            tapIntent.putExtra("route", "/sos");
            PendingIntent tapPi = PendingIntent.getActivity(
                ctx, 911, tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Maroon accent color (#951345)
            int maroon = android.graphics.Color.parseColor("#951345");

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, SOS_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle("🚨 SOS — " + sender + " needs help!")
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("🆘 " + message))
                // Maroon accent — colors the app icon, title line, and
                // notification background tint on supported launchers/ROMs
                .setColor(maroon)
                .setColorized(true)
                // Blinking LED — maroon, 300ms on / 300ms off
                .setLights(maroon, 300, 300)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                // Silent ONLY because SOSSirenService.startSiren() is enabled and
                // provides the audio. This channel's sound is the device default
                // alarm ringtone — a melody on MIUI, which doesn't convey an
                // emergency — so the synthesized wailing siren is used instead.
                //
                // Verified on-device: Android does NOT auto-display the payload's
                // `notification` block separately, so this notification is the only
                // channel-sound source. That means silencing it while the siren is
                // ALSO disabled produces total silence — the two must always be
                // changed together. If you ever re-disable startSiren(), remove this
                // setSilent in the same edit.
                .setSilent(true)
                // Guards against the alarm repeating: this is posted more than once
                // per SOS on the same SOS_NOTIFICATION_ID, and each notify() on an
                // existing id re-alerts.
                .setOnlyAlertOnce(true)
                .setContentIntent(tapPi);

            nm.notify(SOS_NOTIFICATION_ID, b.build());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    public static void ensureSosChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(SOS_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            SOS_CHANNEL_ID, SOS_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Emergency SOS alerts from family members");

        // Silent by design. SOSSirenService plays the actual alarm — a
        // synthesized siren on STREAM_ALARM at max volume. A channel sound here
        // layered the stock ringtone over it, which is the second, non-siren
        // sound heard on every alert.
        channel.setSound(null, null);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 500});
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);

        try { nm.deleteNotificationChannel("sos_alerts");    } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel("sos_alerts_v2"); } catch (Exception ignored) {}
    }

    /**
     * Audible channel for the incoming-call push. Rings with the device
     * ringtone (not the alarm tone SOS uses) so a closed-app call sounds like
     * a call. Android plays this itself when it auto-displays the payload's
     * `notification` block, which is the only audio path available while the
     * app is closed and CallRingingService cannot run.
     */
    public static void ensureCallChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CALL_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CALL_CHANNEL_ID, CALL_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Incoming voice and video calls from family members");

        android.net.Uri ringUri = android.media.RingtoneManager
            .getActualDefaultRingtoneUri(ctx, android.media.RingtoneManager.TYPE_RINGTONE);
        if (ringUri == null) {
            ringUri = android.media.RingtoneManager
                .getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE);
        }
        if (ringUri == null) {
            ringUri = android.media.RingtoneManager
                .getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);
        }
        android.media.AudioAttributes attrs = new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(ringUri, attrs);
        channel.enableVibration(true);
        // Ring-cadence pulse, distinct from the SOS morse pattern.
        channel.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    public static void ensureMessageChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(MSG_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            MSG_CHANNEL_ID, MSG_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription("New messages from family members");

        android.net.Uri notifUri = android.net.Uri.parse(
            "android.resource://" + ctx.getPackageName() + "/" + R.raw.message_tone
        );
        android.media.AudioAttributes attrs = new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(notifUri, attrs);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 120, 60, 120});
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);

        try { nm.deleteNotificationChannel("family_messages");    } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel("family_messages_v2"); } catch (Exception ignored) {}
    }

    private void showMessageNotification(Context appCtx, String senderName, String content, int muteLevel) {
        ensureMessageChannelStatic(appCtx);

        NotificationManager nm =
            (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent intent = new Intent(appCtx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("open_messages", true);

        PendingIntent pi = PendingIntent.getActivity(
            appCtx, 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // muteLevel 1 = sound off but banner still shows → use PRIORITY_LOW + silent channel
        // muteLevel 0 = normal
        NotificationCompat.Builder b = new NotificationCompat.Builder(
                appCtx, muteLevel >= 1 ? MSG_SILENT_CHANNEL_ID : MSG_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("💬 " + senderName)
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setPriority(muteLevel >= 1 ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(pi);

        nm.notify((int) System.currentTimeMillis(), b.build());
        // Sound is handled by channel — silent channel has no sound set
    }

    public static boolean isSirenRunning() {
        return SOSSirenService.isRunning;
    }

    public static void stopSOSAlarm() {
        SOSSirenService.cutAudio();
    }

    /** Silent notification channel — banner visible but no sound or vibration. */
    public static void ensureSilentChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(MSG_SILENT_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            MSG_SILENT_CHANNEL_ID, MSG_SILENT_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW   // LOW = no sound, no vibration
        );
        ch.setDescription("Family messages — silent mode");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }
}
