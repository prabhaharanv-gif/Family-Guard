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

    public static volatile boolean isRunning = false;

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
    private String callerName = getString(R.string.a_family_member);
    private String callType   = "voice";
    private String callerAvatar = "";
    private boolean launchActivity = true;

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
        // Defaults true (FCM/backgrounded path — no visible UI to fall back
        // on, so the native full-screen Activity is what brings the app
        // forward). CallAlarmPlugin passes false: the app is already alive
        // and foreground when that path fires, so GlobalIncomingCall (the JS
        // overlay) already covers it — launching the native Activity too
        // produced two independent accept surfaces stacked on screen.
        launchActivity = (intent == null) || intent.getBooleanExtra("launch_activity", true);

        // Safety net independent of the foreground flag: if the screen is off,
        // there is by definition no visible in-app UI to accept the call on,
        // so the full-screen alert must show. Guards against any lifecycle
        // callback failing to clear that flag, which previously suppressed the
        // alert whenever the phone was locked.
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                if (!launchActivity) {
                    Log.d("FamoraCall", "CallRingingService: screen off — forcing full-screen alert");
                }
                launchActivity = true;
            }
        } catch (Exception e) {
            Log.e("FamoraCall", "screen-state check failed", e);
        }

        isRunning = true;

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
            Notification notif = buildForegroundNotification();

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
        // NOTE: do not cancel the FCM-posted call banner here. Cancelling it
        // was tried to remove the duplicate notification and it also took the
        // full-screen incoming-call alert with it, which is the single most
        // important part of the call UX. Two notifications is the acceptable
        // cost of keeping that alert reliable.
        if (launchActivity) {
            launchRingingActivity();
        } else {
            Log.d("FamoraCall", "CallRingingService: skipping native Activity — app already foreground");
        }

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

    private Notification buildForegroundNotification() {
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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CALL_RING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle(getString(R.string.notif_call_title, label, callerName))
            .setContentText(getString(R.string.notif_tap_to_answer))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentPi);

        // Only attach the full-screen intent (which brings up the native
        // ringing Activity) when this ring was triggered from a backgrounded/
        // killed state — when the app's already foreground, GlobalIncomingCall
        // (the JS overlay) is the only accept/decline surface that should show.
        if (launchActivity) {
            Intent fsIntent = new Intent(this, CallRingingActivity.class);
            fsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            fsIntent.putExtra(CallRingingActivity.EXTRA_CALL_ID,     callId);
            fsIntent.putExtra(CallRingingActivity.EXTRA_CALLER_NAME, callerName);
            fsIntent.putExtra(CallRingingActivity.EXTRA_CALL_TYPE,   callType);
            fsIntent.putExtra(CallRingingActivity.EXTRA_CALLER_AVATAR, callerAvatar);
            PendingIntent fsPi = PendingIntent.getActivity(
                this, 3, fsIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.setFullScreenIntent(fsPi, true);
        }

        return builder.build();
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
