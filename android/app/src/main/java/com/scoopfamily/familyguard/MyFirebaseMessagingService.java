package com.scoopfamily.familyguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

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

    public  static final String SOS_CHANNEL_ID   = "sos_alerts_v3";
    private static final String SOS_CHANNEL_NAME = "SOS Emergency Alerts";
    public  static final int    SOS_NOTIFICATION_ID = 911;

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

        Context appCtx = getApplicationContext();

        if ("sos".equals(type)) {
            String sender  = data.containsKey("sender")  ? data.get("sender")  : "A family member";
            String message = data.containsKey("message") ? data.get("message") : "SOS Alert";

            ensureSosChannelStatic(appCtx);

            Intent sirenIntent = new Intent(appCtx, SOSSirenService.class);
            sirenIntent.putExtra("sender",  sender);
            sirenIntent.putExtra("message", message);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(sirenIntent);
            } else {
                appCtx.startService(sirenIntent);
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

        android.net.Uri alarmUri = android.media.RingtoneManager
            .getDefaultUri(android.media.RingtoneManager.TYPE_ALARM);
        if (alarmUri == null) {
            alarmUri = android.media.RingtoneManager
                .getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);
        }
        android.media.AudioAttributes attrs = new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(alarmUri, attrs);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 500});
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);

        try { nm.deleteNotificationChannel("sos_alerts");    } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel("sos_alerts_v2"); } catch (Exception ignored) {}
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
            .setSmallIcon(R.mipmap.ic_launcher)
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
