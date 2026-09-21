package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Rings a fake incoming call, after an optional countdown.
 *
 * Someone who feels unsafe can make their phone "ring" with a believable caller
 * and walk away on the pretext of answering it. Nothing is sent anywhere: no
 * SOS, no family alert, no network at all.
 *
 * Two triggers, both chosen because they cannot fire by accident and cannot
 * collide with the phone's own emergency features (power presses dial 112 in
 * India, and volume holds are invisible to a background app — see the
 * volume-hold spike notes):
 *   · the timer in Profile ("call me in 30 s"), through FakeCallPlugin;
 *   · the "Call me" button on the location notification, reachable from the
 *     lock screen without unlocking.
 *
 * Deliberately separate from CallRingingService rather than a mode of it. That
 * service carries a long list of hard-won fixes for real family calls; a fake
 * call must never be able to disturb one. The lock-screen mechanics are copied
 * from it instead: start the Activity directly, and only if it fails to appear
 * re-post the notification loud with a full-screen intent.
 */
public class FakeCallService extends Service {

    private static final String TAG = "FakeCall";

    static final String ACTION_SCHEDULE = "com.scoopfamily.familyguard.FAKE_CALL_SCHEDULE";
    static final String ACTION_STOP     = "com.scoopfamily.familyguard.FAKE_CALL_STOP";
    static final String ACTION_SILENCE  = "com.scoopfamily.familyguard.FAKE_CALL_SILENCE";
    static final String EXTRA_DELAY_S   = "delay_s";

    private static final int NOTIF_ID = 4901;
    /** A real unanswered call gives up after roughly this long. */
    private static final long RING_TIMEOUT_MS = 45_000;

    /** Silent, heads-up capable: the fallback that hands the alert the lock screen. */
    static final String RING_CHANNEL_ID  = "fake_call_ring_v1";
    /** Silent, no heads-up: the countdown, and the ringing notification once the screen is up. */
    static final String QUIET_CHANNEL_ID = "fake_call_quiet_v1";

    enum State { IDLE, SCHEDULED, RINGING }

    static volatile State state = State.IDLE;
    /** Wall-clock time the scheduled call rings, for the app to show a countdown. */
    static volatile long ringAt = 0;

    private static volatile FakeCallService instance;
    private static volatile boolean alertAppeared = false;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock cpuLock, screenLock;

    // ── Entry points ─────────────────────────────────────────────────────────

    /** Rings after {@code delaySeconds}; replaces any call already scheduled or ringing. */
    static void schedule(Context ctx, int delaySeconds) {
        Intent i = new Intent(ctx, FakeCallService.class)
            .setAction(ACTION_SCHEDULE)
            .putExtra(EXTRA_DELAY_S, FakeCallPrefs.clampDelay(delaySeconds));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void stop(Context ctx) {
        FakeCallActivity.finishIfShowing();
        ctx.stopService(new Intent(ctx, FakeCallService.class));
    }

    /** The notification button: same as the timer, with a short fixed delay. */
    static PendingIntent notificationButtonIntent(Context ctx) {
        Intent i = new Intent(ctx, FakeCallService.class)
            .setAction(ACTION_SCHEDULE)
            .putExtra(EXTRA_DELAY_S, FakeCallPrefs.NOTIFICATION_DELAY_S);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? PendingIntent.getForegroundService(ctx, 4902, i, flags)
            : PendingIntent.getService(ctx, 4902, i, flags);
    }

    /** Called by FakeCallActivity once it is on screen. */
    static void alertShown() {
        alertAppeared = true;
        FakeCallService self = instance;
        if (self == null || state != State.RINGING) return;
        self.post(self.buildRinging(true, false));
    }

    /** Volume keys on the ringing screen: stop the sound, keep the call. */
    static void silence() {
        FakeCallService self = instance;
        if (self != null) self.main.post(self::stopSound);
    }

    /** Answered: the service's job ends, the Activity carries the call from here. */
    static void answered(Context ctx) {
        FakeCallService self = instance;
        if (self != null) self.main.post(() -> { self.stopSound(); self.stopSelf(); });
    }

    // ── Service ──────────────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        instance = this;
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            FakeCallActivity.finishIfShowing();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SILENCE.equals(action)) {
            stopSound();
            return START_NOT_STICKY;
        }

        // Anything else is a schedule. A second one replaces the first rather
        // than stacking two calls.
        int delayS = intent != null ? intent.getIntExtra(EXTRA_DELAY_S, 0) : 0;
        main.removeCallbacksAndMessages(null);
        stopSound();
        FakeCallActivity.finishIfShowing();

        ensureChannels(this);
        ringAt = System.currentTimeMillis() + delayS * 1000L;
        startInForeground(buildCountdown());

        if (delayS <= 0) {
            ring();
        } else {
            state = State.SCHEDULED;
            acquireCpuLock(delayS * 1000L + RING_TIMEOUT_MS + 5_000);
            main.postDelayed(this::ring, delayS * 1000L);
            Log.i(TAG, "scheduled in " + delayS + "s");
        }
        return START_NOT_STICKY;
    }

    private void ring() {
        state = State.RINGING;
        alertAppeared = false;
        acquireCpuLock(RING_TIMEOUT_MS + 5_000);
        wakeScreen();

        boolean screenOn = true;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            screenOn = pm == null || pm.isInteractive();
        } catch (Exception ignored) {}
        // Loud only with the screen off, where it is what earns the lock screen;
        // with the screen on it would only draw a banner over the call screen.
        post(buildRinging(screenOn, false));

        startSound();
        launchActivity();
        main.postDelayed(this::promoteIfMissing, 1200);
        main.postDelayed(() -> {
            Log.i(TAG, "not answered — giving up");
            FakeCallActivity.finishIfShowing();
            stopSelf();
        }, RING_TIMEOUT_MS);
        Log.i(TAG, "ringing, screenOn=" + screenOn);
    }

    private void launchActivity() {
        try {
            startActivity(activityIntent().addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION));
        } catch (Exception e) {
            Log.w(TAG, "direct launch failed: " + e.getMessage());
        }
    }

    private void promoteIfMissing() {
        if (state != State.RINGING || alertAppeared || FakeCallActivity.isShowing()) return;
        Log.w(TAG, "call screen did not appear — attaching full-screen intent");
        post(buildRinging(false, true));
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        stopSound();
        release(cpuLock);
        release(screenLock);
        state = State.IDLE;
        ringAt = 0;
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Notifications ────────────────────────────────────────────────────────

    private void startInForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIF_ID, n,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                        | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, n,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
        }
    }

    private void post(Notification n) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "notify failed: " + e.getMessage());
        }
    }

    /**
     * Worded neutrally on purpose. It sits on the lock screen for the length of
     * the countdown, and "fake call in 30 s" is exactly what should not be read
     * over someone's shoulder.
     */
    private Notification buildCountdown() {
        return new NotificationCompat.Builder(this, QUIET_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle(getString(R.string.fake_call_scheduled_title))
            .setWhen(ringAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .addAction(0, getString(R.string.fake_call_cancel), stopIntent())
            .build();
    }

    private Notification buildRinging(boolean quiet, boolean withFullScreen) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this,
                quiet ? QUIET_CHANNEL_ID : RING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(FakeCallPrefs.displayName(this))
            .setContentText(getString(R.string.fake_call_incoming))
            .setPriority(quiet ? NotificationCompat.PRIORITY_MIN : NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 4903, activityIntent(),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (!quiet) b.setCategory(NotificationCompat.CATEGORY_CALL);
        if (withFullScreen) {
            b.setFullScreenIntent(PendingIntent.getActivity(this, 4904, activityIntent(),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE), true);
        }
        return b.build();
    }

    private Intent activityIntent() {
        return new Intent(this, FakeCallActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private PendingIntent stopIntent() {
        Intent i = new Intent(this, FakeCallService.class).setAction(ACTION_STOP);
        return PendingIntent.getService(this, 4905, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Both channels are silent: the service plays the ringtone itself. */
    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (nm.getNotificationChannel(RING_CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(RING_CHANNEL_ID,
                ctx.getString(R.string.ch_fake_call_name), NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription(ctx.getString(R.string.ch_fake_call_desc));
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        } else {
            NotificationChannels.refreshText(ctx, nm, RING_CHANNEL_ID,
                R.string.ch_fake_call_name, R.string.ch_fake_call_desc);
        }

        if (nm.getNotificationChannel(QUIET_CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(QUIET_CHANNEL_ID,
                ctx.getString(R.string.ch_fake_call_quiet_name), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(ctx.getString(R.string.ch_fake_call_desc));
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        } else {
            NotificationChannels.refreshText(ctx, nm, QUIET_CHANNEL_ID,
                R.string.ch_fake_call_quiet_name, R.string.ch_fake_call_desc);
        }
    }

    // ── Sound, vibration, wake ───────────────────────────────────────────────

    /**
     * The phone's own ringtone, on the ringtone usage, so it obeys the ringer
     * exactly as a real call would: silent mode stays silent. Vibration runs
     * regardless, so the call is still felt on a silenced phone.
     */
    private void startSound() {
        stopSound();
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.w(TAG, "ringtone failed: " + e.getMessage());
            if (player != null) { try { player.release(); } catch (Exception ignored) {} }
            player = null;
        }

        try {
            vibrator = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? ((VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
                : (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = { 0, 1000, 800 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "vibration failed: " + e.getMessage());
        }
    }

    private void stopSound() {
        if (player != null) {
            try { if (player.isPlaying()) player.stop(); player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private void acquireCpuLock(long timeoutMs) {
        try {
            release(cpuLock);
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Famora::FakeCall");
            cpuLock.setReferenceCounted(false);
            cpuLock.acquire(timeoutMs);
        } catch (Exception e) {
            Log.w(TAG, "cpu wake lock failed: " + e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private void wakeScreen() {
        try {
            release(screenLock);
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            screenLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "Famora::FakeCallScreen");
            screenLock.setReferenceCounted(false);
            screenLock.acquire(10_000);
        } catch (Exception e) {
            Log.w(TAG, "screen wake lock failed: " + e.getMessage());
        }
    }

    private static void release(PowerManager.WakeLock lock) {
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception ignored) {}
    }
}
