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
    public  static final int    SOS_NOTIFICATION_ID = 911;

    /**
     * The SOS channel actually in use, which depends on whether Famora held Do
     * Not Disturb access when the channel was created.
     *
     * setBypassDnd(true) below is not a request the system merely honours or
     * ignores at post time — NotificationManagerService overwrites the field
     * with false at CREATION when the app lacks notification policy access, and
     * a channel's settings are immutable afterwards (calling
     * createNotificationChannel again on the same id updates only the name and
     * description). So the bypass has been stored as false on every install:
     * the permission was never even declared until now, and declaring it is not
     * enough either, because the channel is created on first run and the user
     * grants the access later.
     *
     * A new id is the only way to re-create a channel with different settings,
     * so the id carries the state it was created under. The moment access is
     * granted the app starts posting to "..._dnd", which is created right then,
     * with access held, and therefore really does bypass Do Not Disturb. This
     * is the same shape as family_messages_v4_<hash> keying its id to its
     * sound, and for the same underlying reason. See SosDnd.
     */
    public static String sosChannelId(Context ctx) {
        return SosDnd.hasAccess(ctx) ? SOS_CHANNEL_ID + "_dnd" : SOS_CHANNEL_ID;
    }

    // Audible channel for the FCM `notification` block on an incoming call.
    // When the app is CLOSED, Android displays that block itself and rings
    // using THIS channel's sound — our CallRingingService (which owns the
    // ringtone while the app is alive) never runs. CallRingingService's own
    // channel is deliberately silent so the two don't double-ring, which left
    // closed-app calls arriving with no sound at all until this was split out.
    // Mirrors the sos_alerts_v3 (audible push) + sos_popup_v1 (silent service)
    // pairing that makes SOS work from a closed app.
    public  static final String CALL_CHANNEL_ID   = "incoming_calls_ring_v1";

    private static final String MSG_CHANNEL_BASE = "family_messages_v4";
    private static final String KEY_MSG_CHANNEL  = "msg_channel_id";

    /**
     * Channel id for the currently selected message tone.
     *
     * A NotificationChannel's sound is fixed at creation, and deleting a channel
     * then recreating it under the same id restores the old settings — so the
     * only way to actually change the sound is a different id. It is derived
     * from the sound URI, giving one stable channel per distinct choice.
     */
    private static String msgChannelId(Context ctx) {
        android.net.Uri chosen = RingtonePlugin.getUri(ctx, RingtonePlugin.KEY_MESSAGE);
        String tag = (chosen == null)
            ? "default"
            : Integer.toHexString(chosen.toString().hashCode());
        return MSG_CHANNEL_BASE + "_" + tag;
    }
    // Sound & pop-up muted: IMPORTANCE_LOW — no sound, no vibration, no pop-up;
    // the message waits quietly in the notification list (mute level 1).
    private static final String MSG_SILENT_CHANNEL_ID   = "family_messages_silent";

    // Sound muted: IMPORTANCE_HIGH with no sound — the pop-up still appears,
    // silently (mute level 3). Independent of the chosen tone, so one fixed id.
    private static final String MSG_POPUP_SILENT_CHANNEL_ID = "family_messages_popup_silent_v1";

    // Pop-up muted: IMPORTANCE_DEFAULT with the chosen tone — the sound plays but
    // nothing pops up (mute level 4). It carries the tone, so like the main
    // message channel it needs an id per tone; the last one made is remembered so
    // rebuildMessageChannel can delete it when the tone changes.
    private static final String MSG_QUIET_CHANNEL_BASE = "family_messages_quiet_v1";
    private static final String KEY_MSG_QUIET_CHANNEL  = "msg_quiet_channel_id";

    private static String msgQuietChannelId(Context ctx) {
        return msgChannelId(ctx).replace(MSG_CHANNEL_BASE, MSG_QUIET_CHANNEL_BASE);
    }

    // Shared preference key written by MainActivity when Messages page is open
    public static final String PREF_NAME          = "fg_prefs";

    /**
     * Delete and recreate the message channel so a newly chosen tone takes
     * effect. A NotificationChannel's sound is fixed once created — updating it
     * in place is silently ignored — so this is the only way to change it
     * without inventing a new channel id on every selection.
     */
    public static void rebuildMessageChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            // Remove the channel the previous selection used, plus the two
            // historical ids, so switching sounds does not leave a growing list
            // of stale channels in system settings.
            android.content.SharedPreferences p = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String previous = p.getString(KEY_MSG_CHANNEL, null);
            if (previous != null) nm.deleteNotificationChannel(previous);
            nm.deleteNotificationChannel("family_messages_v3");
            // The pop-up-muted channel carries the old tone too. It is not
            // rebuilt here — ensureQuietMessageChannelStatic makes it with the
            // new tone the next time that mute level is used.
            String previousQuiet = p.getString(KEY_MSG_QUIET_CHANNEL, null);
            if (previousQuiet != null) nm.deleteNotificationChannel(previousQuiet);

            ensureMessageChannelStatic(ctx);
            p.edit()
                .putString(KEY_MSG_CHANNEL, msgChannelId(ctx))
                .remove(KEY_MSG_QUIET_CHANNEL)
                .apply();
        } catch (Exception e) { e.printStackTrace(); }
    }
    /**
     * Whether the last full-screen alert failed to reach the screen.
     *
     * There is no API for MIUI's "display pop-up windows while running in
     * background" permission — it cannot be read, only refused — so the setup
     * sheet had no way to tell whether the one thing it exists to ask for was
     * ever granted, and closed itself after checking the two permissions it
     * COULD read. Users skipped past it and quietly got the degraded path.
     *
     * The refusal is observable though: when CallRingingService or
     * SOSSirenService starts its alert Activity and the Activity never appears,
     * that IS the permission being denied. Recording it here turns an
     * unreadable permission into evidence the app can act on, and clearing it
     * on the next alert that DOES appear means the prompt stops by itself once
     * the user has fixed it — no guessing in either direction.
     */
    public static final String KEY_ALERT_BLOCKED  = "fullscreen_alert_blocked";

    /** Called by the alert services with what actually happened on screen. */
    public static void setAlertBlocked(Context ctx, boolean blocked) {
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
               .edit().putBoolean(KEY_ALERT_BLOCKED, blocked).apply();
        } catch (Exception e) { /* diagnostics only — never fail an alert for this */ }
    }

    public static boolean isAlertBlocked(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                      .getBoolean(KEY_ALERT_BLOCKED, false);
        } catch (Exception e) { return false; }
    }

    public static final String KEY_MESSAGES_OPEN  = "messages_page_open";
    // Same integers as src/lib/muteLevel.js, which explains why they are not in
    // menu order. 2 is the retired "all notifications off", treated as 1.
    public static final String KEY_MUTE_LEVEL     = "msg_mute_level";
    public static final int MUTE_NONE             = 0;
    public static final int MUTE_SOUND_AND_POPUP  = 1;
    public static final int MUTE_LEGACY_ALL_OFF   = 2;
    public static final int MUTE_SOUND            = 3;
    public static final int MUTE_POPUP            = 4;

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        Log.d("FamoraCall", "onMessageReceived: type=" + type + " data=" + data);

        Context appCtx = getApplicationContext();

        if ("sos".equals(type)) {
            String sender  = data.containsKey("sender")  ? data.get("sender")  : getString(R.string.a_family_member);
            String message = data.containsKey("message") ? data.get("message") : getString(R.string.sos_alert);
            String lat     = data.containsKey("lat") ? data.get("lat") : "";
            String lng     = data.containsKey("lng") ? data.get("lng") : "";
            String phone   = data.containsKey("phone") ? data.get("phone") : "";
            String sosId   = data.containsKey("sos_id") ? data.get("sos_id") : "";

            ensureSosChannelStatic(appCtx);

            // Start the siren foreground service (audio + vibration)
            Intent sirenIntent = new Intent(appCtx, SOSSirenService.class);
            sirenIntent.putExtra("sender",  sender);
            sirenIntent.putExtra("message", message);
            sirenIntent.putExtra("lat",     lat);
            sirenIntent.putExtra("lng",     lng);
            sirenIntent.putExtra("phone",   phone);
            sirenIntent.putExtra("sos_id",  sosId);
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

        } else if ("sos_resolved".equals(type)) {
            // The sender tapped "I am safe now".
            handleSosResolved(appCtx, data.get("sos_id"), data.get("sender"));

        } else if ("call".equals(type)) {
            String callId     = data.containsKey("call_id")     ? data.get("call_id")     : "";
            String callerName = data.containsKey("caller_name") ? data.get("caller_name") : getString(R.string.a_family_member);
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
            // audio). Neither path decides where the alert shows, so order
            // does not matter; CallRingingService.isRunning makes whichever
            // arrives second a no-op instead of re-triggering the ring.
            Intent ringIntent = new Intent(appCtx, CallRingingService.class);
            ringIntent.putExtra("call_id",     callId);
            ringIntent.putExtra("caller_name", callerName);
            ringIntent.putExtra("call_type",   callType);
            ringIntent.putExtra("caller_avatar", data.containsKey("caller_avatar") ? data.get("caller_avatar") : "");
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
            String sender = data.containsKey("sender") ? data.get("sender") : getString(R.string.a_family_member);

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

            // Respect the mute level chosen on the Messages page. Every level
            // still posts a notification; it only decides sound and pop-up.
            int muteLevel = prefs.getInt(KEY_MUTE_LEVEL, MUTE_NONE);

            String sender  = data.containsKey("sender")  ? data.get("sender")  : "Family";
            String content = data.containsKey("content") ? data.get("content") : "New message";
            showMessageNotification(appCtx, sender, content, muteLevel);

        } else if ("place_enter".equals(type) || "place_exit".equals(type)) {
            // Plain notification, same shape as "message" above — no foreground
            // service, no full-screen intent. That machinery is SOS's, not this.
            String sender    = data.containsKey("sender")     ? data.get("sender")     : "Family";
            String placeName = data.containsKey("place_name") ? data.get("place_name") : "a place";
            showPlaceNotification(appCtx, sender, placeName, "place_enter".equals(type));

        } else if ("device_alert".equals(type)) {
            // Low battery / phone off / back online for a family member. Plain
            // notification like the place alerts: no service, no full-screen.
            String sender   = data.containsKey("sender")     ? data.get("sender")     : "Family";
            String kind     = data.containsKey("kind")       ? data.get("kind")       : "";
            int battery     = parseIntOr(data.get("battery"), -1);
            int silentMin   = parseIntOr(data.get("silent_min"), 0);
            showDeviceAlertNotification(appCtx, sender, kind, battery, silentMin,
                parseIntOr(data.get("speed"), -1), parseIntOr(data.get("limit"), -1));

        } else if ("weather_alert".equals(type)) {
            // Severe weather due at one of THIS phone's owner's saved places.
            // Plain notification, like the device alerts.
            showWeatherAlertNotification(appCtx,
                data.containsKey("kind") ? data.get("kind") : "",
                data.containsKey("place_name") ? data.get("place_name") : "your place",
                parseLongOr(data.get("at"), 0L),
                parseIntOr(data.get("temp"), 0),
                parseIntOr(data.get("gust"), 0),
                parseIntOr(data.get("rain"), 0));

        } else if ("lost_phone".equals(type)) {
            // This phone was marked lost (or found again) by a family admin or its
            // owner, who had allowed it. Time-critical: no waiting for the app.
            if ("stop".equals(data.get("action"))) {
                LostPhone.stop(appCtx);
            } else {
                LostPhone.start(appCtx,
                    data.containsKey("message") ? data.get("message") : "",
                    data.containsKey("starter") ? data.get("starter") : "",
                    parseLongOr(data.get("until"), 0L));
            }

        } else if ("unlock_alert".equals(type)) {
            // Somebody entered the wrong screen-lock password several times on a
            // phone whose owner switched this on; we are one of that family admins.
            // No position and no photo in the push — those are read in the app.
            showUnlockAlertNotification(appCtx,
                data.containsKey("sender") ? data.get("sender") : "Family",
                parseIntOr(data.get("attempts"), 3));

        } else if ("nearby_help_request".equals(type)) {
            // Famora Social: this phone's owner is one of the closest opted-in
            // strangers to an unanswered SOS. Only the fuzzy area is carried —
            // the real coordinates are never sent until accept_nearby_help
            // succeeds (see NearbyHelpActionReceiver).
            String notificationId = data.containsKey("notification_id")  ? data.get("notification_id")  : "";
            String escalationId   = data.containsKey("escalation_id")    ? data.get("escalation_id")    : "";
            String tier           = data.containsKey("tier")             ? data.get("tier")             : "";
            String fuzzyLat       = data.containsKey("fuzzy_lat")        ? data.get("fuzzy_lat")        : "";
            String fuzzyLng       = data.containsKey("fuzzy_lng")        ? data.get("fuzzy_lng")        : "";
            String fuzzyRadiusM   = data.containsKey("fuzzy_radius_m")   ? data.get("fuzzy_radius_m")   : "";
            String helpKind       = data.containsKey("help_kind")        ? data.get("help_kind")        : "police";

            Log.d("FamoraCall", "onMessageReceived: posting nearby-help request for " + notificationId);
            // Not a foreground service — see NearbyHelpRingService's class doc.
            // This just builds and posts one notification; there is no
            // continuous playback to protect with a service or a wake lock.
            NearbyHelpRingService.show(appCtx, notificationId, escalationId, tier, fuzzyLat, fuzzyLng, fuzzyRadiusM, helpKind);

        } else if ("nearby_help_standdown".equals(type) || "nearby_help_cancelled".equals(type)) {
            // Someone else already accepted, or the SOS was resolved. Either
            // way this bystander no longer needs to do anything — cancel the
            // tray notification if it is still showing for this escalation,
            // and stop the ring if it is still going.
            String escalationId = data.containsKey("escalation_id") ? data.get("escalation_id") : "";
            Log.d("FamoraCall", "onMessageReceived: nearby help " + type + " for escalation " + escalationId);
            NearbyHelpRingService.standDown(appCtx, escalationId);

        } else if ("nearby_help_accepted".equals(type) || "nearby_help_exhausted".equals(type)) {
            // Lands on the SOS SENDER's own phone — count/informational only,
            // never a bystander's identity. No foreground service: this is a
            // resume-time fallback for a backgrounded/killed app. The
            // live/foregrounded case is handled by the web layer over
            // Supabase Realtime, not by this push.
            String sosAlertId = data.containsKey("sos_alert_id") ? data.get("sos_alert_id") : "";
            String helpKind = data.containsKey("help_kind") ? data.get("help_kind") : "police";
            showNearbyHelpSenderStatus(appCtx, sosAlertId, "nearby_help_accepted".equals(type), helpKind);
        }
    }

    // ── SOS resolved ("I'm safe now") ─────────────────────────────────────────
    /** Posted when the sender marks themselves safe and no alert screen is in front. */
    public  static final int    SOS_SAFE_NOTIFICATION_ID = 913;
    private static final String SOS_SAFE_CHANNEL_ID      = "sos_safe_v1";
    /** Last alert handled here, so the push and the realtime copy act once. */
    private static volatile String lastResolvedSosId = "";

    /**
     * The sender tapped "I'm safe now". Reached from the sos_resolved push and,
     * with the app alive, from realtime via SOSAlarmPlugin.showResolved.
     *
     * This is RESOLVED, not silenced: the siren and the SOS shade entry go, and
     * the alert screen turns into its "safe now" state instead of vanishing —
     * an alert that simply disappeared left recipients unsure whether they had
     * only silenced it or the person was really safe. If the screen is not in
     * front (closed, or left for Maps/the dialler), a notification says so.
     *
     * Matched by sos id: with two people's SOS open, resolving one must not
     * stop the other's siren or say the wrong person is safe. An id missing on
     * either side (an older edge function) falls back to the previous
     * behaviour of treating it as the alert on screen.
     */
    public static void handleSosResolved(Context ctx, String sosId, String sender) {
        final Context appCtx = ctx.getApplicationContext();
        if (sosId == null) sosId = "";
        if (!sosId.isEmpty() && sosId.equals(lastResolvedSosId)) return;
        if (!sosId.isEmpty()) lastResolvedSosId = sosId;

        String current = SOSSirenService.currentSosId;
        boolean sameAlert = sosId.isEmpty() || current == null || current.isEmpty()
            || sosId.equals(current);

        String name = sender;
        if ((name == null || name.isEmpty()) && sameAlert) name = SOSSirenService.currentSender;
        if (name == null || name.isEmpty()) name = appCtx.getString(R.string.a_family_member);

        if (!sameAlert) {
            // Someone else's SOS is still open on this phone; leave it alone.
            Log.i("FamoraCall", "SOS " + sosId + " resolved — a different alert is live, not touching it");
            showSosSafeNotification(appCtx, name);
            return;
        }

        Log.i("FamoraCall", "SOS resolved — stopping siren, showing the safe state");
        SOSSirenService.stopService(appCtx);
        try {
            NotificationManager nm =
                (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(SOS_NOTIFICATION_ID);
        } catch (Exception e) {
            Log.w("FamoraCall", "could not clear the SOS notification: " + e.getMessage());
        }
        if (!SOSAlertActivity.showResolvedIfShowing(name)) {
            showSosSafeNotification(appCtx, name);
        }
    }

    private static void showSosSafeNotification(Context ctx, String name) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (nm.getNotificationChannel(SOS_SAFE_CHANNEL_ID) != null) {
                    NotificationChannels.refreshText(ctx, nm, SOS_SAFE_CHANNEL_ID,
                        R.string.ch_sos_safe_name, R.string.ch_sos_safe_desc);
                } else {
                    // Default notification sound, not the siren: this is good news.
                    NotificationChannel ch = new NotificationChannel(SOS_SAFE_CHANNEL_ID,
                        ctx.getString(R.string.ch_sos_safe_name), NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription(ctx.getString(R.string.ch_sos_safe_desc));
                    nm.createNotificationChannel(ch);
                }
            }

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            tap.putExtra("route", "/sos");
            PendingIntent tapPi = PendingIntent.getActivity(ctx, 913, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, SOS_SAFE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#12925B"))
                .setContentTitle(ctx.getString(R.string.sos_safe_title, name))
                .setContentText(ctx.getString(R.string.sos_marked_safe, name))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(tapPi);
            // This phone's owner has their own SOS open and may be hiding.
            if (SosSilence.isActive(ctx)) b.setSilent(true);
            nm.notify(SOS_SAFE_NOTIFICATION_ID, b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the SOS safe notification: " + e.getMessage());
        }
    }

    // ── Places: "reached Home" / "left Home" ─────────────────────────────────
    private static final String PLACE_CHANNEL_ID = "family_places_v1";

    private static void showPlaceNotification(Context ctx, String sender, String placeName, boolean entered) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (nm.getNotificationChannel(PLACE_CHANNEL_ID) != null) {
                    NotificationChannels.refreshText(ctx, nm, PLACE_CHANNEL_ID,
                        R.string.ch_places_name, R.string.ch_places_desc);
                } else {
                    // Default notification sound — its own channel so it can be
                    // muted independently of chat, but not something a family
                    // member needs to be woken up for.
                    NotificationChannel ch = new NotificationChannel(PLACE_CHANNEL_ID,
                        ctx.getString(R.string.ch_places_name), NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription(ctx.getString(R.string.ch_places_desc));
                    nm.createNotificationChannel(ch);
                }
            }

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tapPi = PendingIntent.getActivity(ctx, 914, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            String title = ctx.getString(
                entered ? R.string.place_reached_title : R.string.place_left_title,
                sender, placeName);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, PLACE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(title)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(tapPi);
            nm.notify((int) System.currentTimeMillis(), b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the place notification: " + e.getMessage());
        }
    }

    // ── Device alerts: low battery / phone off / back online ─────────────────
    private static final String DEVICE_CHANNEL_ID = "device_alerts_v1";

    private static int parseIntOr(String v, int fallback) {
        try { return Integer.parseInt(v == null ? "" : v.trim()); } catch (Exception e) { return fallback; }
    }

    /** 45 -> "45 min", 135 -> "2 h 15 min". */
    private static String formatSilence(int minutes) {
        if (minutes < 60) return minutes + " min";
        int h = minutes / 60, m = minutes % 60;
        return m == 0 ? h + " h" : h + " h " + m + " min";
    }

    private static void showDeviceAlertNotification(Context ctx, String sender, String kind, int battery, int silentMin,
                                                    int speed, int limit) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(DEVICE_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(DEVICE_CHANNEL_ID,
                    ctx.getString(R.string.ch_device_name), NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription(ctx.getString(R.string.ch_device_desc));
                nm.createNotificationChannel(ch);
            }

            String title;
            String body;
            String batt = battery >= 0 ? battery + "%" : "";
            switch (kind) {
                case "battery_critical":
                    title = ctx.getString(R.string.device_critical_title, sender);
                    body  = ctx.getString(R.string.device_critical_body, batt);
                    break;
                case "battery_low":
                    title = ctx.getString(R.string.device_low_title, sender);
                    body  = ctx.getString(R.string.device_low_body, batt);
                    break;
                case "phone_offline":
                    title = ctx.getString(R.string.device_offline_title, sender);
                    body  = battery >= 0 && battery <= 15
                        ? ctx.getString(R.string.device_offline_body_battery, formatSilence(silentMin), batt)
                        : ctx.getString(R.string.device_offline_body, formatSilence(silentMin));
                    break;
                case "overspeed":
                    title = ctx.getString(R.string.device_overspeed_title, sender);
                    body  = ctx.getString(R.string.device_overspeed_body, speed, limit);
                    break;
                case "overspeed_self":
                    title = ctx.getString(R.string.device_overspeed_self_title);
                    body  = ctx.getString(R.string.device_overspeed_self_body, speed, limit);
                    break;
                case "back_online":
                    title = ctx.getString(R.string.device_back_title, sender);
                    body  = ctx.getString(R.string.device_back_body);
                    break;
                default:
                    return;
            }

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tapPi = PendingIntent.getActivity(ctx, 916, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, DEVICE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(tapPi);
            nm.notify((int) System.currentTimeMillis(), b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the device alert: " + e.getMessage());
        }
    }

    // ── Wrong-password alert ────────────────────────────────────────────────
    private static void showUnlockAlertNotification(Context ctx, String sender, int attempts) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            // Same channel as the battery / phone-off alerts: it is about a member's phone.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(DEVICE_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(DEVICE_CHANNEL_ID,
                    ctx.getString(R.string.ch_device_name), NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription(ctx.getString(R.string.ch_device_desc));
                nm.createNotificationChannel(ch);
            }
            String title = ctx.getString(R.string.unlock_alert_title, sender);
            String body  = ctx.getString(R.string.unlock_alert_body, attempts);

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            tap.putExtra("open_route", "/profile?group=antitheft");
            PendingIntent tapPi = PendingIntent.getActivity(ctx, 918, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, DEVICE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(tapPi);
            nm.notify((int) System.currentTimeMillis(), b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the unlock alert: " + e.getMessage());
        }
    }

    // ── Weather alerts: severe weather at a saved place ─────────────────────
    private static final String WEATHER_CHANNEL_ID = "weather_alerts_v1";

    private static long parseLongOr(String v, long fallback) {
        try { return Long.parseLong(v == null ? "" : v.trim()); } catch (Exception e) { return fallback; }
    }

    private static void showWeatherAlertNotification(Context ctx, String kind, String place,
                                                     long atSec, int temp, int gust, int rain) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(WEATHER_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(WEATHER_CHANNEL_ID,
                    ctx.getString(R.string.ch_weather_name), NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription(ctx.getString(R.string.ch_weather_desc));
                nm.createNotificationChannel(ch);
            }

            String title;
            String detail;
            switch (kind) {
                case "thunderstorm":
                    title  = ctx.getString(R.string.weather_title_thunderstorm, place);
                    detail = ctx.getString(R.string.weather_detail_thunderstorm);
                    break;
                case "heavy_rain":
                    title  = ctx.getString(R.string.weather_title_heavy_rain, place);
                    detail = rain > 0 ? ctx.getString(R.string.weather_detail_heavy_rain_mm, rain)
                                      : ctx.getString(R.string.weather_detail_heavy_rain);
                    break;
                case "heat":
                    title  = ctx.getString(R.string.weather_title_heat, place);
                    detail = ctx.getString(R.string.weather_detail_heat, temp);
                    break;
                case "wind":
                    title  = ctx.getString(R.string.weather_title_wind, place);
                    detail = ctx.getString(R.string.weather_detail_wind, gust);
                    break;
                default: return;
            }

            long nowMs = System.currentTimeMillis();
            String when;
            if (atSec <= 0 || atSec * 1000L <= nowMs + 30 * 60 * 1000L) {
                when = ctx.getString(R.string.weather_when_now);
            } else {
                when = ctx.getString(R.string.weather_when_at,
                    new java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault())
                        .format(new java.util.Date(atSec * 1000L)));
            }
            String body = ctx.getString(R.string.weather_body, when, detail);

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            tap.putExtra("open_route", "/profile?group=places");
            PendingIntent tapPi = PendingIntent.getActivity(ctx, 917, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, WEATHER_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(tapPi);
            nm.notify((int) nowMs, b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the weather alert: " + e.getMessage());
        }
    }

    // ── Nearby-help: sender-side status fallback ──────────────────────────────
    // nearby_help_accepted / nearby_help_exhausted, both landing on the SOS
    // SENDER's own phone. See NearbyHelpRingService for the bystander side.
    private static final String NEARBY_HELP_STATUS_CHANNEL_ID     = "nearby_help_status_v1";
    public  static final int    NEARBY_HELP_STATUS_NOTIFICATION_ID = 915;

    /**
     * Cached so the WebView can read it back on resume — the same
     * resume-time-fallback shape as KEY_ALERT_BLOCKED. The live/foregrounded
     * case is Realtime, not this; this exists only for a backgrounded or
     * killed app that missed the live update.
     */
    public static final String KEY_NEARBY_HELP_SOS_ID = "nearby_help_sos_id";
    /** Value is "helper_found" or "exhausted". */
    public static final String KEY_NEARBY_HELP_STATUS = "nearby_help_status";

    private static void showNearbyHelpSenderStatus(Context ctx, String sosAlertId, boolean helperFound, String helpKind) {
        try {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NEARBY_HELP_SOS_ID, sosAlertId == null ? "" : sosAlertId)
                .putString(KEY_NEARBY_HELP_STATUS, helperFound ? "helper_found" : "exhausted")
                .apply();
        } catch (Exception e) { /* diagnostics only — never fail the notification for this */ }

        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (nm.getNotificationChannel(NEARBY_HELP_STATUS_CHANNEL_ID) != null) {
                    NotificationChannels.refreshText(ctx, nm, NEARBY_HELP_STATUS_CHANNEL_ID,
                        R.string.ch_nearby_help_status_name, R.string.ch_nearby_help_status_desc);
                } else {
                    // Low priority and silent on purpose — this is reassurance/
                    // fallback information, not something that should interrupt
                    // someone mid-emergency with a second sound on top of
                    // whatever the SOS screen itself is already playing.
                    NotificationChannel ch = new NotificationChannel(NEARBY_HELP_STATUS_CHANNEL_ID,
                        ctx.getString(R.string.ch_nearby_help_status_name), NotificationManager.IMPORTANCE_LOW);
                    ch.setDescription(ctx.getString(R.string.ch_nearby_help_status_desc));
                    ch.setSound(null, null);
                    ch.enableVibration(false);
                    nm.createNotificationChannel(ch);
                }
            }

            Intent tap = new Intent(ctx, MainActivity.class);
            tap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            tap.putExtra("route", "/sos");
            PendingIntent tapPi = PendingIntent.getActivity(ctx, NEARBY_HELP_STATUS_NOTIFICATION_ID, tap,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, NEARBY_HELP_STATUS_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(ctx.getString(helperFound
                    ? R.string.notif_nearby_help_sender_accepted_title
                    : R.string.notif_nearby_help_sender_exhausted_title))
                .setContentText(helperFound
                    ? ctx.getString(R.string.notif_nearby_help_sender_accepted_body)
                    : ctx.getString(R.string.notif_nearby_help_sender_exhausted_body, NearbyHelpKind.number(helpKind)))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(tapPi);
            nm.notify(NEARBY_HELP_STATUS_NOTIFICATION_ID, b.build());
        } catch (Exception e) {
            Log.w("FamoraCall", "could not post the nearby-help status notification: " + e.getMessage());
        }
    }

    // ── SOS heads-up notification ─────────────────────────────────────────────
    // Posted from onMessageReceived() alongside the siren service.
    // Uses the sos_alerts_v3 channel (alarm sound + bypass DND + max priority)
    // so MIUI shows it on the lock screen. Tapping opens MainActivity → /sos.
    public static void showSosNotification(Context ctx, String sender, String message,
                                            String lat, String lng, String phone) {
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

            // Full-screen intent — the SECOND chance at the full-screen alert,
            // and the only one that can actually fire.
            //
            // SOSSirenService's own ongoing notification also carries one, but
            // its channel is IMPORTANCE_LOW and SystemUI discards a full-screen
            // intent below IMPORTANCE_HIGH before it checks anything else. This
            // notification is on SOS_CHANNEL_ID, which is IMPORTANCE_HIGH, so
            // here it is honoured. That matters because the direct
            // startActivity() in SOSSirenService.launchAlertActivity() is
            // refused outright on MIUI unless "Display pop-up windows while
            // running in background" is on — and this method is only called
            // when the alert was seen NOT to appear, which is exactly that
            // case. Where the direct launch worked, nothing here is posted, so
            // there is still only ever one announcement per emergency.
            //
            // Demotion to a heads-up banner is the intended floor, not a
            // failure: a banner naming who needs help beats a siren over a
            // blank screen.
            Intent fsIntent = new Intent(ctx, SOSAlertActivity.class);
            fsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            fsIntent.putExtra(SOSAlertActivity.EXTRA_SENDER,  sender);
            fsIntent.putExtra(SOSAlertActivity.EXTRA_MESSAGE, message);
            fsIntent.putExtra(SOSAlertActivity.EXTRA_LAT,     lat  == null ? "" : lat);
            fsIntent.putExtra(SOSAlertActivity.EXTRA_LNG,     lng  == null ? "" : lng);
            fsIntent.putExtra(SOSAlertActivity.EXTRA_PHONE,   phone == null ? "" : phone);
            PendingIntent fsPi = PendingIntent.getActivity(
                ctx, 912, fsIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // SOS crimson (#C8102E) — the same --sos the web app uses: maroon family,
            // but brighter than the brand maroon so an SOS never looks routine
            int sosRed = android.graphics.Color.parseColor("#C8102E");

            // Make sure the channel matching the CURRENT access state exists
            // before posting to it — access can be granted between app start
            // and an alert, and posting to an id with no channel is dropped.
            ensureSosChannelStatic(ctx);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, sosChannelId(ctx))
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(ctx.getString(R.string.notif_sos_title, sender))
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("🆘 " + message))
                // SOS crimson — colors the app icon, title line, and
                // notification background tint on supported launchers/ROMs
                .setColor(sosRed)
                .setColorized(true)
                // Blinking LED — red, 300ms on / 300ms off
                .setLights(sosRed, 300, 300)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                // CATEGORY_CALL, not CATEGORY_ALARM. This is the notification
                // that has to take over the screen when the direct activity
                // start was refused, and on MIUI a call-category entry is the
                // one the ROM insists must float. Same reasoning as
                // CallRingingService's loud fallback, which this mirrors.
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                // setSilent(true) was here and it was killing the full-screen
                // alert. NotificationCompat implements it by ALSO calling
                // setGroup(GROUP_KEY_SILENT) + setGroupAlertBehavior(
                // GROUP_ALERT_SUMMARY) on O+. With no summary notification ever
                // posted, that marks this entry non-alerting, and SystemUI will
                // not launch the full-screen intent of a notification that does
                // not alert — so the one mechanism left for taking over the
                // screen was disabled by the call meant only to stop a sound.
                //
                // Dropping it costs nothing audible: the channel itself is
                // created with setSound(null, null), so there is no channel
                // sound to suppress, and from O onwards the channel — not the
                // builder — owns vibration, so the pattern is unchanged either
                // way. The siren remains the only audio source.
                //
                // If startSiren() is ever disabled again, give the CHANNEL a
                // sound rather than restoring setSilent here.
                // Guards against the alarm repeating: this is posted more than once
                // per SOS on the same SOS_NOTIFICATION_ID, and each notify() on an
                // existing id re-alerts.
                .setOnlyAlertOnce(true)
                .setContentIntent(tapPi)
                .setFullScreenIntent(fsPi, true);

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

        // Which of the two ids this install should be on right now — see
        // sosChannelId(). Granting DND access moves it to the "_dnd" one.
        final String id = sosChannelId(ctx);

        if (nm.getNotificationChannel(id) != null) {
            NotificationChannels.refreshText(ctx, nm, id,
                R.string.ch_sos_name, R.string.ch_sos_desc);
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            id, ctx.getString(R.string.ch_sos_name), NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(ctx.getString(R.string.ch_sos_desc));

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

        // Retire whichever of the pair is no longer in use, so notification
        // settings does not list two identical "SOS alerts" entries and leave
        // the person toggling the one the app stopped posting to.
        try {
            nm.deleteNotificationChannel(
                id.equals(SOS_CHANNEL_ID) ? SOS_CHANNEL_ID + "_dnd" : SOS_CHANNEL_ID);
        } catch (Exception ignored) {}
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
        if (nm.getNotificationChannel(CALL_CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, CALL_CHANNEL_ID,
                R.string.ch_calls_name, R.string.ch_calls_desc);
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CALL_CHANNEL_ID, ctx.getString(R.string.ch_calls_name), NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(ctx.getString(R.string.ch_calls_desc));

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
        if (nm == null) return;

        // Retire the pre-v4 channel. It stored its sound as a numeric resource
        // id, which stopped resolving to message_tone once res/raw was
        // renumbered, so it survives only as a silent entry in system settings.
        try { nm.deleteNotificationChannel("family_messages_v3"); } catch (Exception ignored) {}

        String channelId = msgChannelId(ctx);
        if (nm.getNotificationChannel(channelId) != null) {
            NotificationChannels.refreshText(ctx, nm, channelId,
                R.string.ch_messages_name, R.string.ch_messages_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            channelId, ctx.getString(R.string.ch_messages_name), NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription(ctx.getString(R.string.ch_messages_desc));
        ch.setSound(messageToneUri(ctx), notificationAudioAttributes());
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

        // On Android 8+ the channel decides sound and pop-up; the priority only
        // matters below that, and is kept in step with the channel for it.
        String channelId;
        int priority;
        switch (muteLevel) {
            case MUTE_SOUND:            // pop-up, no sound
                ensurePopupSilentChannelStatic(appCtx);
                channelId = MSG_POPUP_SILENT_CHANNEL_ID;
                priority  = NotificationCompat.PRIORITY_HIGH;
                break;
            case MUTE_POPUP:            // sound, no pop-up
                channelId = ensureQuietMessageChannelStatic(appCtx);
                priority  = NotificationCompat.PRIORITY_DEFAULT;
                break;
            case MUTE_SOUND_AND_POPUP:  // neither — waits in the notification list
            case MUTE_LEGACY_ALL_OFF:
                ensureSilentChannelStatic(appCtx);
                channelId = MSG_SILENT_CHANNEL_ID;
                priority  = NotificationCompat.PRIORITY_LOW;
                break;
            default:                    // not muted
                channelId = msgChannelId(appCtx);
                priority  = NotificationCompat.PRIORITY_DEFAULT;
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(appCtx, channelId)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("💬 " + senderName)
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setPriority(priority)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(pi);

        nm.notify((int) System.currentTimeMillis(), b.build());
    }

    /**
     * The message tone: the user's choice if they made one, otherwise the
     * bundled tone.
     *
     * Referenced by NAME, not by R.raw's numeric id. A channel stores this URI
     * permanently, and raw resource ids are renumbered whenever a file is added
     * to res/raw — adding emergency_alert.mp3 shifted message_tone from
     * 0x7f0d0001 to 0x7f0d0003, leaving the live channel pointing at
     * firebase_common_keep and playing nothing at all. The named form survives
     * that.
     */
    private static android.net.Uri messageToneUri(Context ctx) {
        android.net.Uri chosen = RingtonePlugin.getUri(ctx, RingtonePlugin.KEY_MESSAGE);
        if (chosen != null) return chosen;
        return android.net.Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/message_tone");
    }

    private static android.media.AudioAttributes notificationAudioAttributes() {
        return new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    /** Sound muted: the pop-up still appears, with no sound or vibration. */
    public static void ensurePopupSilentChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(MSG_POPUP_SILENT_CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, MSG_POPUP_SILENT_CHANNEL_ID,
                R.string.ch_messages_popup_silent_name, R.string.ch_messages_popup_silent_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            MSG_POPUP_SILENT_CHANNEL_ID, ctx.getString(R.string.ch_messages_popup_silent_name),
            NotificationManager.IMPORTANCE_HIGH   // HIGH = pops up; no sound set below
        );
        ch.setDescription(ctx.getString(R.string.ch_messages_popup_silent_desc));
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }

    /**
     * Pop-up muted: the tone plays but nothing pops up. Returns the channel id,
     * which follows the chosen tone — see MSG_QUIET_CHANNEL_BASE.
     */
    public static String ensureQuietMessageChannelStatic(Context ctx) {
        String channelId = msgQuietChannelId(ctx);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return channelId;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return channelId;
        if (nm.getNotificationChannel(channelId) != null) {
            NotificationChannels.refreshText(ctx, nm, channelId,
                R.string.ch_messages_quiet_name, R.string.ch_messages_quiet_desc);
            return channelId;
        }

        NotificationChannel ch = new NotificationChannel(
            channelId, ctx.getString(R.string.ch_messages_quiet_name),
            NotificationManager.IMPORTANCE_DEFAULT   // DEFAULT = sound, no pop-up
        );
        ch.setDescription(ctx.getString(R.string.ch_messages_quiet_desc));
        ch.setSound(messageToneUri(ctx), notificationAudioAttributes());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 120, 60, 120});
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);

        ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_MSG_QUIET_CHANNEL, channelId).apply();
        return channelId;
    }

    public static boolean isSirenRunning() {
        return SOSSirenService.isRunning;
    }

    public static void stopSOSAlarm() {
        SOSSirenService.cutAudio();
    }

    /** Sound & pop-up muted: no sound, no vibration, no pop-up — list entry only. */
    public static void ensureSilentChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(MSG_SILENT_CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, MSG_SILENT_CHANNEL_ID,
                R.string.ch_messages_silent_name, R.string.ch_messages_silent_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            MSG_SILENT_CHANNEL_ID, ctx.getString(R.string.ch_messages_silent_name),
            NotificationManager.IMPORTANCE_LOW   // LOW = no sound, no vibration
        );
        ch.setDescription(ctx.getString(R.string.ch_messages_silent_desc));
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }
}
