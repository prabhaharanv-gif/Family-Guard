package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that rings for an incoming call — same structure as
 * SOSSirenService (wake lock, full-screen intent + direct startActivity
 * fallback, mediaPlayback|specialUse foreground type on API 34+), but plays
 * the device's default ringtone on loop instead of a synthesized siren, and
 * auto-stops sooner (35s) since an unanswered call should give up quickly.
 *
 * CallRingingActivity is the incoming-call screen in all three states — app
 * open, app backgrounded, phone locked — the same rule SOSAlertActivity
 * already follows for SOS. It is started exactly ONE way: directly, by this
 * service. The notification that accompanies it starts LOUD (high-importance
 * channel, CATEGORY_CALL) only while the SCREEN IS OFF, because on MIUI a
 * notification classified as unimportant does not get handed the lock screen.
 * With the screen on it starts quiet instead — see startForeground below. It
 * carries NO full-screen intent either way, because that would be a second
 * way in.
 *
 * Two ways in is not redundancy, it is a race. With the intent attached the
 * system started the Activity too, about 80ms after this service did:
 *
 *     START CallRingingActivity from pid <app>   ← this service
 *     START CallRingingActivity from pid -1      ← the full-screen intent
 *
 * The Activity is singleTask, so the second start did not create anything —
 * it arrived at the instance the first one had just made. The call screen
 * appeared and vanished within a second, and because that path never reaches
 * onCreate, the notification was never quieted either and its banner stayed.
 *
 * The cost of loud is a heads-up banner. Under the full-screen alert on a
 * locked phone nobody sees it; with the app open it sits on top of the call
 * screen, announcing a call the user is already looking at. So it is taken
 * back down — not on a guess about the phone's state, but on word from the
 * Activity itself: onCreate calls alertShown(), and the notification is
 * re-posted on the quiet channel then, about 80ms later. That is inside the
 * heads-up animation, so the banner does not arrive rather than arriving and
 * leaving.
 *
 * Nothing predicts which state the phone is in, because nothing can. Screen
 * state is knowable, but the keyguard is not: isKeyguardLocked() reports TRUE
 * with the app in the foreground on an awake phone (mKeyguardShowing=true,
 * occluded by our own window), so it cannot tell "the user is in the app" from
 * "the user is at a lock screen". MainActivity.isAppInForeground cannot tell
 * them apart either — MainActivity sets showWhenLocked and so stays resumed
 * over a locked phone, and the flag goes stale with the screen off besides,
 * which is what MainActivity.onPause's comment is about. Every arrangement
 * built on either of those fixed one state by breaking another.
 *
 * The quieting applies in every state. It was once skipped while the screen
 * was off, on the theory that the locked path should be left untouched from
 * the moment it works — but what the locked path actually needed was never the
 * notification staying loud; it was the keyguard bouncer not being summoned
 * over it (see CallRingingActivity.onCreate). Loudness has done its whole job
 * once the Activity exists, and leaving it in place only meant the banner
 * turned up later, next to a full-screen alert that was already there.
 *
 * The full-screen intent is still the fallback, just no longer a parallel
 * route. If the direct start is refused — an OEM blocking background activity
 * starts — alertShown() never fires, and a moment later the notification is
 * re-posted loud WITH the intent attached, which is the system's own way in.
 * By then there is no race left to lose, because the first way in did not
 * happen.
 */
public class CallRingingService extends Service {

    public  static final String ACTION_STOP    = "com.scoopfamily.familyguard.STOP_CALL_RING";
    // Silences sound/vibration but keeps the call ringing for the caller and
    // leaves the full-screen UI up — what the volume keys do on a dialler.
    public  static final String ACTION_SILENCE = "com.scoopfamily.familyguard.SILENCE_CALL_RING";
    private static final int    FOREGROUND_ID = 9211;

    // v2: v1 got created (on some test devices) before bypassDnd was set, and
    // Android permanently locks a channel's settings after creation — same
    // fix pattern as sos_alerts_v3/family_messages_v3 in
    // MyFirebaseMessagingService. Old channel is deleted in ensureCallRingChannelStatic.
    public  static final String CALL_RING_CHANNEL_ID   = "incoming_calls_v2";

    // Same notification, no heads-up. See the class comment.
    //
    // v2: MIUI raised v1 from the IMPORTANCE_LOW it was created with to HIGH
    // and marked the importance user-locked (mImportance=4, mOriginalImp=2,
    // mUserLockedFields=4 in `dumpsys notification`), which put the heads-up
    // banner back on top of the full-screen alert. A channel's settings cannot
    // be changed after creation, so the id has to move to get a quiet one —
    // same fix pattern as incoming_calls_v2 and sos_alerts_v4 above. v1 is
    // deleted in ensureCallQuietChannelStatic.
    public  static final String CALL_QUIET_CHANNEL_ID  = "incoming_calls_quiet_v2";


    public static volatile boolean isRunning = false;

    // The running service, so CallRingingActivity can report that the alert is
    // up. Held the same way RingtonePlugin holds its preview: the call comes
    // from another component entirely.
    private static volatile CallRingingService instance = null;

    // Whether the screen was on when the call arrived. The only piece of state
    // that is worth asking about — see the class comment.
    private boolean screenOn = true;

    private MediaPlayer ringtonePlayer = null;
    private android.media.Ringtone fallbackRingtone = null;
    // Watches system volume so a volume-key press silences the ringer even
    // when this app never receives the key event — on the lock screen the
    // keyguard consumes volume keys, so CallRingingActivity.onKeyDown alone
    // never fired and the ringer could not be silenced there.
    private android.database.ContentObserver volumeObserver = null;
    private Vibrator vibrator = null;
    private PowerManager.WakeLock wakeLock = null;
    private PowerManager.WakeLock screenWakeLock = null;

    private String callId     = "";
    // Deliberately a plain literal, NOT getString(R.string.a_family_member):
    // field initializers run from the constructor, before the framework
    // attaches the base context, so getResources() NPEs there and the service
    // dies in <init> — every incoming call crashed on the callee's phone with
    // "Unable to create service". onStartCommand applies the localized default
    // below, where a context exists, and it is the only thing that ever writes
    // this field before it is read.
    private String callerName = "";
    private String callType   = "voice";
    private String callerAvatar = "";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d("FamoraCall", "CallRingingService.onStartCommand action=" + (intent != null ? intent.getAction() : "null"));

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            releaseWakeLock();
            stopRingtone();
            cancelVibration();
            unregisterVolumeObserver();
            // Close the full-screen alert too — it used to stay on top after
            // the call was already over (caller hung up, or the ring timed
            // out), leaving a dead screen the user had to dismiss.
            CallRingingActivity.finishIfShowing();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_SILENCE.equals(intent.getAction())) {
            silenceLocally();
            return START_NOT_STICKY;
        }

        // The websocket path (CallAlarmPlugin) and the FCM path
        // (MyFirebaseMessagingService) can both fire for the SAME call,
        // shortly apart, in either order — see the comments at each call
        // site. Whichever arrives first fully sets up the ring; treat a
        // second trigger for the call already ringing as a no-op rather than
        // restarting the ringtone (which was audibly killing it mid-playback).
        String incomingCallId = (intent != null) ? intent.getStringExtra("call_id") : null;
        if (isRunning && incomingCallId != null && incomingCallId.equals(callId)) {
            Log.d("FamoraCall", "CallRingingService: duplicate trigger for already-ringing call " + callId + " — ignoring");
            return START_NOT_STICKY;
        }

        acquireWakeLock();

        callId     = (intent != null) ? intent.getStringExtra("call_id") : null;
        callerName = (intent != null) ? intent.getStringExtra("caller_name") : null;
        callType   = (intent != null) ? intent.getStringExtra("call_type") : null;
        callerAvatar = (intent != null) ? intent.getStringExtra("caller_avatar") : null;
        if (callerAvatar == null) callerAvatar = "";
        if (callId == null) callId = "";
        if (callerName == null || callerName.isEmpty()) callerName = getString(R.string.a_family_member);
        if (callType == null || callType.isEmpty()) callType = "voice";
        // Only whether the screen is on. Keyguard and foreground state are both
        // unreliable here and neither is consulted — see the class comment.
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            screenOn = (pm == null) || pm.isInteractive();
        } catch (Exception e) {
            Log.e("FamoraCall", "screen-state check failed", e);
            screenOn = true;
        }
        Log.d("FamoraCall", "CallRingingService: screenOn=" + screenOn);

        isRunning = true;
        instance   = this;

        // startForeground() MUST be called within a few seconds of this method
        // starting or the OS kills the process — wrapped defensively so any
        // failure building the fancy notification doesn't silently swallow the
        // whole call (this was likely why calls only rang while the app was
        // already open: the websocket path calls CallAlarm.trigger() from an
        // active foreground context, immune to background-start restrictions,
        // while this FCM-triggered path runs from a genuinely backgrounded
        // process where any uncaught exception here previously killed the
        // service before it ever rang).
        try {
            ensureCallRingChannelStatic(getApplicationContext());
            ensureCallQuietChannelStatic(getApplicationContext());
            // Loud only when the screen is off, where loudness is what gets the
            // alert onto a locked phone and no one can see a banner anyway.
            //
            // With the screen already on there is nothing for it to buy: the
            // Activity is started directly either way, and the notification
            // being loud for the ~220ms before onCreate reports back was long
            // enough for MIUI to draw the heads-up over the call screen. Posted
            // quiet from the start, that window does not exist. Should the
            // launch fail, promoteIfAlertMissing() below still turns it loud
            // and attaches the full-screen intent.
            Notification notif = buildForegroundNotification(screenOn, false);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    FOREGROUND_ID, notif,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                        | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                );
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    FOREGROUND_ID, notif,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(FOREGROUND_ID, notif);
            }
            Log.d("FamoraCall", "CallRingingService: startForeground succeeded for call " + callId);
        } catch (Exception e) {
            Log.e("FamoraCall", "CallRingingService: startForeground FAILED", e);
        }

        startRingtone();
        startVibration();
        // Delay so our own ring-volume bump in startRingtone() is not mistaken
        // for the user pressing a volume key.
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(this::registerVolumeObserver, 1200L);
        forceScreenOn();

        // The alert itself, and the only route to it — see the class comment.
        launchRingingActivity();

        // If it did not come up, hand the job to the system's full-screen
        // intent. Late enough that a working direct start has always already
        // reported in through alertShown().
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(this::promoteIfAlertMissing, 1200L);

        // Give up sooner than SOS (60s) — an unanswered call shouldn't ring forever.
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> {
                releaseWakeLock();
                stopRingtone();
                cancelVibration();
                unregisterVolumeObserver();
                // Ring timed out — take the full-screen alert down with it.
                CallRingingActivity.finishIfShowing();
                stopSelf();
            }, 35_000L);

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        stopRingtone();
        cancelVibration();
        unregisterVolumeObserver();
        isRunning = false;
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── WakeLock helpers (identical pattern to SOSSirenService) ──────────────
    private void acquireWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Famora::CallRingWakeLock");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(40_000L);
        } catch (Exception e) { e.printStackTrace(); }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        } catch (Exception ignored) {}
        try {
            if (screenWakeLock != null && screenWakeLock.isHeld()) screenWakeLock.release();
            screenWakeLock = null;
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void forceScreenOn() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            screenWakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "Famora::CallScreenWakeLock"
            );
            screenWakeLock.setReferenceCounted(false);
            screenWakeLock.acquire(10_000L);
        } catch (Exception e) { e.printStackTrace(); }
    }

    private void launchRingingActivity() {
        try {
            Intent i = new Intent(this, CallRingingActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            i.putExtra(CallRingingActivity.EXTRA_CALL_ID,     callId);
            i.putExtra(CallRingingActivity.EXTRA_CALLER_NAME, callerName);
            i.putExtra(CallRingingActivity.EXTRA_CALL_TYPE,   callType);
            i.putExtra(CallRingingActivity.EXTRA_CALLER_AVATAR, callerAvatar);
            startActivity(i);
            Log.d("FamoraCall", "CallRingingService: launched CallRingingActivity directly");
        } catch (Exception e) {
            Log.e("FamoraCall", "CallRingingService: launchRingingActivity FAILED", e);
        }
    }

    /**
     * @param quiet          post on the silent channel — the alert is already on
     *                       screen, so a banner would only duplicate it.
     * @param withFullScreen attach the full-screen intent. Only the fallback
     *                       does: while the direct start is working, this being
     *                       set means the system races us to the same Activity.
     */
    private Notification buildForegroundNotification(final boolean quiet,
                                                     final boolean withFullScreen) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("call_id", callId);
        openIntent.putExtra("call_notification", true);
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 1, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String label = getString("voice".equals(callType)
            ? R.string.notif_call_voice_label
            : R.string.notif_call_video_label);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this,
                quiet ? CALL_QUIET_CHANNEL_ID : CALL_RING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle(getString(R.string.notif_call_title, label, callerName))
            .setContentText(getString(R.string.notif_tap_to_answer))
            .setPriority(quiet ? NotificationCompat.PRIORITY_MIN
                               : NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentPi);

        // CATEGORY_CALL only on the loud one, which is the fallback that is
        // MEANT to be a banner. MIUI treats a call-category notification as one
        // that must float, and promoting the channel behind it is how it does
        // that — the reason v1 above had to be abandoned. The quiet
        // notification sits beside a screen already showing the call, so the
        // category buys it nothing and costs the whole fix.
        if (!quiet) builder.setCategory(NotificationCompat.CATEGORY_CALL);
        if (withFullScreen) builder.setFullScreenIntent(fullScreenPendingIntent(), true);

        return builder.build();
    }

    /** Opens CallRingingActivity for this call. */
    private PendingIntent fullScreenPendingIntent() {
        Intent fsIntent = new Intent(this, CallRingingActivity.class);
        fsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fsIntent.putExtra(CallRingingActivity.EXTRA_CALL_ID,     callId);
        fsIntent.putExtra(CallRingingActivity.EXTRA_CALLER_NAME, callerName);
        fsIntent.putExtra(CallRingingActivity.EXTRA_CALL_TYPE,   callType);
        fsIntent.putExtra(CallRingingActivity.EXTRA_CALLER_AVATAR, callerAvatar);
        return PendingIntent.getActivity(
            this, 3, fsIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /**
     * Called by CallRingingActivity.onCreate the moment the full-screen alert
     * exists. The loud notification has done its job by then — it bought the
     * Activity the keyguard — so it is re-posted quiet and the heads-up banner
     * it would have drawn never lands, in any state.
     *
     * setOnlyAlertOnce on the builder is what keeps the re-post from alerting
     * a second time.
     */
    public static void alertShown() {
        CallRingingService self = instance;
        if (self == null || !isRunning) return;
        try {
            NotificationManager nm =
                (NotificationManager) self.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(FOREGROUND_ID, self.buildForegroundNotification(true, false));
                Log.d("FamoraCall", "CallRingingService: alert is up — notification quieted");
            }
            // Proof the alert can reach the screen — clears any earlier refusal
            // so the setup prompt stops asking. See KEY_ALERT_BLOCKED.
            MyFirebaseMessagingService.setAlertBlocked(self.getApplicationContext(), false);
        } catch (Exception e) {
            Log.e("FamoraCall", "alertShown failed", e);
        }
    }

    /**
     * The direct start produced nothing. Re-post loud with the full-screen
     * intent so the system opens the alert instead — on a locked phone it
     * launches the Activity, on an unlocked one it is at least a banner to tap.
     *
     * Only ever reached when the Activity is genuinely absent, so it cannot
     * race the launch that already worked.
     */
    private void promoteIfAlertMissing() {
        if (!isRunning || CallRingingActivity.isShowing()) return;
        Log.w("FamoraCall", "CallRingingService: alert did not appear — attaching full-screen intent");
        // The background activity start was refused. Recorded so the setup
        // sheet can ask for the permission that causes it — see KEY_ALERT_BLOCKED.
        MyFirebaseMessagingService.setAlertBlocked(getApplicationContext(), true);
        try {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(FOREGROUND_ID, buildForegroundNotification(false, true));
        } catch (Exception e) {
            Log.e("FamoraCall", "promoteIfAlertMissing failed", e);
        }
    }

    // Channel sound is null — this service's own looping MediaPlayer is the
    // audio source (same "silent channel, service owns the sound" pattern as
    // SOSSirenService's sos_popup_v1 channel).
    public static void ensureCallRingChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CALL_RING_CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, CALL_RING_CHANNEL_ID,
                R.string.ch_call_ring_name, R.string.ch_call_ring_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            CALL_RING_CHANNEL_ID, ctx.getString(R.string.ch_call_ring_name), NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription(ctx.getString(R.string.ch_call_ring_desc));
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);

        try { nm.deleteNotificationChannel("incoming_calls_v1"); } catch (Exception ignored) {}
    }

    /**
     * The no-banner twin of the channel above. Importance LOW is what keeps it
     * out of the heads-up queue; it is still visible in the shade, which is
     * what a foreground service needs.
     */
    public static void ensureCallQuietChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CALL_QUIET_CHANNEL_ID) != null) {
            NotificationChannels.refreshText(ctx, nm, CALL_QUIET_CHANNEL_ID,
                R.string.ch_call_ring_name, R.string.ch_call_ring_desc);
            return;
        }

        NotificationChannel ch = new NotificationChannel(
            CALL_QUIET_CHANNEL_ID, ctx.getString(R.string.ch_call_ring_name),
            NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription(ctx.getString(R.string.ch_call_ring_desc));
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);

        try { nm.deleteNotificationChannel("incoming_calls_quiet_v1"); } catch (Exception ignored) {}
    }

    // ── Ringtone — device default ringtone, looped ───────────────────────────
    private void startRingtone() {
        stopRingtone();

        // Voice and video calls can be given different sounds, so the two are
        // distinguishable without looking at the screen. Falls through to the
        // device's default ringtone when neither has been set, which is the
        // previous behaviour.
        Uri ringUri = RingtonePlugin.getUri(this,
            "video".equals(callType) ? RingtonePlugin.KEY_VIDEO : RingtonePlugin.KEY_VOICE);
        if (ringUri == null) {
            ringUri = RingtoneManager.getActualDefaultRingtoneUri(
                this, RingtoneManager.TYPE_RINGTONE);
        }
        if (ringUri == null) {
            ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        }

        // Ring stream can be left quiet from a previous session — bring it up,
        // same reasoning as SOSSirenService maxing the alarm stream. Doesn't
        // override silent/DND (that's the OS respecting the user's choice),
        // just avoids an inaudibly-low-but-not-silent ringer volume.
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_RING);
                int target = Math.max(am.getStreamVolume(AudioManager.STREAM_RING), (int) (max * 0.8));
                am.setStreamVolume(AudioManager.STREAM_RING, Math.min(target, max), 0);
            }
        } catch (Exception e) {
            Log.e("FamoraCall", "startRingtone: failed to raise ring volume", e);
        }

        try {
            ringtonePlayer = new MediaPlayer();
            ringtonePlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            ringtonePlayer.setDataSource(this, ringUri);
            ringtonePlayer.setLooping(true);
            ringtonePlayer.prepare();
            ringtonePlayer.start();
            Log.d("FamoraCall", "startRingtone: MediaPlayer ringing");
        } catch (Exception e) {
            // MediaPlayer + a content:// ringtone Uri can fail in states a
            // plain Ringtone.play() tolerates better (e.g. right after the
            // screen wakes from locked) — fall back rather than going silent.
            Log.e("FamoraCall", "startRingtone: MediaPlayer failed, falling back to Ringtone", e);
            try {
                if (ringtonePlayer != null) { ringtonePlayer.release(); ringtonePlayer = null; }
                android.media.Ringtone fallback = RingtoneManager.getRingtone(this, ringUri);
                if (fallback != null) {
                    fallback.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                    fallback.play();
                    fallbackRingtone = fallback;
                    Log.d("FamoraCall", "startRingtone: fallback Ringtone playing");
                }
            } catch (Exception e2) {
                Log.e("FamoraCall", "startRingtone: fallback Ringtone also failed", e2);
            }
        }
    }

    private void stopRingtone() {
        try {
            if (ringtonePlayer != null) {
                if (ringtonePlayer.isPlaying()) ringtonePlayer.stop();
                ringtonePlayer.release();
            }
        } catch (Exception ignored) {}
        ringtonePlayer = null;

        try {
            if (fallbackRingtone != null && fallbackRingtone.isPlaying()) fallbackRingtone.stop();
        } catch (Exception ignored) {}
        fallbackRingtone = null;
    }

    // ── Vibration — steady ring pulse, repeating ─────────────────────────────
    private void startVibration() {
        try {
            vibrator = getVibrator(getApplicationContext());
            if (vibrator == null) return;

            long[] pattern = { 0, 1000, 500 };

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                //noinspection deprecation
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception e) { e.printStackTrace(); }
    }

    private void cancelVibration() {
        try {
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
            }
        } catch (Exception ignored) {}
    }

    private static Vibrator getVibrator(Context ctx) {
        if (ctx == null) return null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm =
                    (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                return vm != null ? vm.getDefaultVibrator() : null;
            }
            return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception e) { return null; }
    }

    /** Stop local ringing only — the call itself keeps ringing for the caller. */
    private void silenceLocally() {
        stopRingtone();
        cancelVibration();
        unregisterVolumeObserver();
    }

    /**
     * Registered a moment AFTER the ringtone starts, because startRingtone()
     * raises the ring stream itself and would otherwise instantly trigger this
     * and silence the call before it ever rang.
     */
    private void registerVolumeObserver() {
        if (volumeObserver != null) return;
        try {
            volumeObserver = new android.database.ContentObserver(
                    new android.os.Handler(android.os.Looper.getMainLooper())) {
                @Override
                public void onChange(boolean selfChange) {
                    Log.d("FamoraCall", "volume changed while ringing — silencing ringer");
                    silenceLocally();
                }
            };
            getContentResolver().registerContentObserver(
                android.provider.Settings.System.CONTENT_URI, true, volumeObserver);
            Log.d("FamoraCall", "volume observer registered");
        } catch (Exception e) {
            Log.e("FamoraCall", "registerVolumeObserver failed", e);
            volumeObserver = null;
        }
    }

    private void unregisterVolumeObserver() {
        try {
            if (volumeObserver != null) {
                getContentResolver().unregisterContentObserver(volumeObserver);
            }
        } catch (Exception ignored) {}
        volumeObserver = null;
    }

    /** Volume-key silence: stops local sound/vibration, call keeps ringing. */
    public static void silence(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallRingingService.class);
            intent.setAction(ACTION_SILENCE);
            context.startService(intent);
        } catch (Exception e) { e.printStackTrace(); }
    }

    public static void stopService(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallRingingService.class);
            intent.setAction(ACTION_STOP);
            context.stopService(intent);
        } catch (Exception e) { e.printStackTrace(); }
    }
}
