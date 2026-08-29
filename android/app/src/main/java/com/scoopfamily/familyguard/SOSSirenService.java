package com.scoopfamily.familyguard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that owns the SOS siren and vibration.
 *
 * Fix for visual alert not showing when app is closed:
 * ─────────────────────────────────────────────────────
 * On Android 14 (API 34)+, a foreground service using ONLY mediaPlayback type
 * cannot trigger full-screen intents. We now declare mediaPlayback|specialUse
 * in the manifest, and call startForeground() with BOTH types on API 34+.
 *
 * We also acquire a PARTIAL_WAKE_LOCK to guarantee the CPU stays awake while
 * we set up the notification — without this, the process can be suspended
 * between onMessageReceived() returning and startForeground() completing on
 * some aggressive OEM skins (Xiaomi MIUI, OPPO ColorOS, etc.).
 *
 * The full-screen intent launches SOSAlertActivity directly over the lock
 * screen — this is the visual alert the family member sees.
 */
public class SOSSirenService extends Service {

    public  static final String ACTION_STOP        = "com.scoopfamily.familyguard.STOP_SIREN";
    private static final int    FOREGROUND_ID      = 9112;
    private static final int    SOS_POPUP_NOTIF_ID = 9113;

    // Silent-but-high-importance channel for the heads-up banner.
    // IMPORTANCE_HIGH = shows as peek banner. setSound(null) = no channel melody
    // (AudioTrack in startSiren() provides the only audio).
    public  static final String SOS_POPUP_CHANNEL_ID   = "sos_popup_v1";
    private static final String SOS_POPUP_CHANNEL_NAME = "SOS Alert Banner";

    // ── Shared state — read by SOSAlarmPlugin and MainActivity ───────────────
    public static volatile boolean isRunning = false;

    // ── Audio state ──────────────────────────────────────────────────────────
    private static volatile boolean sirenRunning = false;
    private static Thread     sirenThread   = null;
    private static AudioTrack sirenTrack    = null;

    // ── Vibrator reference — needed to cancel vibration in onDestroy ─────────
    private Vibrator vibrator = null;

    // ── WakeLock — keeps CPU alive during foreground service startup ─────────
    private PowerManager.WakeLock wakeLock = null;
    // ── Screen WakeLock — forces the display ON so the SOS alert is visible ──
    private PowerManager.WakeLock screenWakeLock = null;

    // ── SOS coordinates — passed through to the full-screen alert activity ───
    private String sosLat = "";
    private String sosLng = "";

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        // A STOP action is sent by stopService(Context) so we clean up properly
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            releaseWakeLock();
            stopSiren();
            cancelVibration();
            stopSelf();
            return START_NOT_STICKY;
        }

        // ── Acquire a WakeLock immediately ───────────────────────────────────
        // FCM gives us a brief wake window. Acquiring our own lock before any
        // heavy work prevents the device from sleeping mid-setup on aggressive
        // OEM skins (MIUI, ColorOS, OneUI with aggressive battery optimisation).
        acquireWakeLock();

        String senderName = (intent != null) ? intent.getStringExtra("sender")  : null;
        String message    = (intent != null) ? intent.getStringExtra("message") : null;
        if (senderName == null || senderName.isEmpty()) senderName = "A family member";
        if (message    == null || message.isEmpty())    message    = "SOS Alert";

        sosLat = (intent != null && intent.getStringExtra("lat") != null) ? intent.getStringExtra("lat") : "";
        sosLng = (intent != null && intent.getStringExtra("lng") != null) ? intent.getStringExtra("lng") : "";

        isRunning = true;

        // ── Must call startForeground within 5 s of onStartCommand ──────────
        ensureSosPopupChannelStatic(getApplicationContext());

        // Android 14+ (API 34) requires BOTH service types passed to startForeground()
        // when the service is declared with mediaPlayback|specialUse in the manifest.
        // Omitting specialUse on API 34+ causes the full-screen intent to be silently
        // blocked even though USE_FULL_SCREEN_INTENT permission is granted.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {  // API 34
            startForeground(
                FOREGROUND_ID,
                buildForegroundNotification(senderName, message),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {  // API 29
            startForeground(
                FOREGROUND_ID,
                buildForegroundNotification(senderName, message),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(FOREGROUND_ID, buildForegroundNotification(senderName, message));
        }

        // NOTE: previously cancelled MyFirebaseMessagingService's SOS_NOTIFICATION_ID
        // notification here — that also silenced/cut short its alarm sound, which is
        // the audio source the user wants (not this service's synthesized siren).
        // Leaving that notification alone so its sound plays uninterrupted.

        // The synthesized wailing siren (600->1600Hz sweep) is the SOS audio.
        // The sos_alerts_v3 channel's sound is the device's default alarm
        // ringtone, which on MIUI is a gentle melody that doesn't read as an
        // emergency — so showSosNotification() is posted silently and this is
        // the sole audio source. Restarting is safe: startSiren() stops any
        // existing siren first, so repeated onMessageReceived calls give one
        // continuous siren rather than overlapping copies.
        startSiren();
        startVibration();

        // ── Force the screen ON and launch the alert directly ────────────────
        // Belt-and-suspenders: the full-screen intent above SHOULD launch
        // SOSAlertActivity, but on some OEMs (and when USE_FULL_SCREEN_INTENT
        // is not honoured) it gets demoted to a silent notification and the
        // screen never wakes. We force the display on with a screen wakelock
        // and attempt to launch the alert activity directly.
        forceScreenOn();
        launchAlertActivity(senderName, message);

        // Safety net: auto-stop after 60 s even if the user never responds
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> {
                releaseWakeLock();
                stopSiren();
                cancelVibration();
                stopSelf();
            }, 60_000L);

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        stopSiren();
        cancelVibration();
        isRunning = false;

        try {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(MyFirebaseMessagingService.SOS_NOTIFICATION_ID);
                nm.cancel(SOS_POPUP_NOTIF_ID);
            }
        } catch (Exception ignored) {}

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ─────────────────────────────────────────────────────────────────────────
    //  WakeLock helpers
    // ─────────────────────────────────────────────────────────────────────────
    private void acquireWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "Famora::SOSSirenWakeLock"
            );
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(65_000L); // 65 s — slightly longer than the 60 s auto-stop
        } catch (Exception e) { e.printStackTrace(); }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            wakeLock = null;
        } catch (Exception ignored) {}
        try {
            if (screenWakeLock != null && screenWakeLock.isHeld()) {
                screenWakeLock.release();
            }
            screenWakeLock = null;
        } catch (Exception ignored) {}
    }

    /**
     * Force the display ON using a screen-bright wakelock with ACQUIRE_CAUSES_WAKEUP.
     * These flags are deprecated but remain the only reliable way for a background
     * service to turn the screen on for an emergency alarm. Held briefly (10 s) —
     * long enough for SOSAlertActivity (which sets turnScreenOn) to take over.
     */
    @SuppressWarnings("deprecation")
    private void forceScreenOn() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            screenWakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "Famora::SOSScreenWakeLock"
            );
            screenWakeLock.setReferenceCounted(false);
            screenWakeLock.acquire(10_000L);
        } catch (Exception e) { e.printStackTrace(); }
    }

    /**
     * Directly launch the full-screen SOS alert activity. This is a fallback for
     * when the notification's full-screen intent is demoted. Background activity
     * starts are restricted on Android 10+, but foreground services started from
     * a high-priority FCM message are granted a short activity-start window, and
     * the FLAG_ACTIVITY_NEW_TASK activity declares showWhenLocked/turnScreenOn.
     * Wrapped in try/catch — if the OS blocks it, the full-screen intent remains.
     */
    private void launchAlertActivity(String senderName, String message) {
        try {
            Intent i = new Intent(this, SOSAlertActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            i.putExtra(SOSAlertActivity.EXTRA_SENDER,  senderName);
            i.putExtra(SOSAlertActivity.EXTRA_MESSAGE, message);
            i.putExtra(SOSAlertActivity.EXTRA_LAT,     sosLat);
            i.putExtra(SOSAlertActivity.EXTRA_LNG,     sosLng);
            startActivity(i);
        } catch (Exception e) { e.printStackTrace(); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Foreground notification with full-screen intent → SOSAlertActivity
    // ─────────────────────────────────────────────────────────────────────────
    private Notification buildForegroundNotification(String senderName, String message) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("sos_notification", true);
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Full-screen intent — launches SOSAlertActivity over the lock screen.
        // On Android 14+, this requires USE_FULL_SCREEN_INTENT runtime permission
        // AND the foreground service type must include specialUse.
        Intent fsIntent = new Intent(this, SOSAlertActivity.class);
        fsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fsIntent.putExtra(SOSAlertActivity.EXTRA_SENDER,  senderName);
        fsIntent.putExtra(SOSAlertActivity.EXTRA_MESSAGE, message);
        fsIntent.putExtra(SOSAlertActivity.EXTRA_LAT,     sosLat);
        fsIntent.putExtra(SOSAlertActivity.EXTRA_LNG,     sosLng);
        PendingIntent fsPi = PendingIntent.getActivity(
            this, 2, fsIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, SOS_POPUP_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("🚨 SOS — " + senderName + " needs help!")
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle()
                .bigText("⚠️ " + senderName + " needs help!\n\n"
                       + message + "\n\nTap to open Famora."))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentPi)
            .setFullScreenIntent(fsPi, true)
            .build();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Popup channel — IMPORTANCE_HIGH, null sound (AudioTrack provides audio)
    // ─────────────────────────────────────────────────────────────────────────
    public static void ensureSosPopupChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(SOS_POPUP_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            SOS_POPUP_CHANNEL_ID, SOS_POPUP_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription("SOS alert banner — audio is provided by the app");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Synthesized emergency siren
    // ─────────────────────────────────────────────────────────────────────────
    private void startSiren() {
        stopSiren();

        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setStreamVolume(AudioManager.STREAM_ALARM,
                    am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (Exception e) { e.printStackTrace(); }

        sirenRunning = true;
        sirenThread  = new Thread(() -> {
            final int    SAMPLE_RATE  = 44100;
            final double SWEEP_PERIOD = 0.7;
            final double FREQ_LOW     = 600.0;
            final double FREQ_HIGH    = 1600.0;
            // The waveform below (0.75 + 0.25 harmonic mix) peaks at amplitude 1.0.
            // GAIN was 1.35, which pushed every peak past 1.0 into the hard clamp a
            // few lines down — that's audible digital clipping, not extra loudness
            // (loudness is already maxed separately via track/stream volume). Clipping
            // added a harsh, buzzy distortion on top of the siren that read as
            // "broken speaker" rather than "urgent alarm". 0.92 keeps the tone at
            // full, clean volume with a small headroom margin so it never clips,
            // while the pitch/sweep (what actually conveys urgency) is unchanged.
            final double GAIN         = 0.92;

            AudioTrack track = null;
            try {
                int minBuf = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minBuf <= 0) minBuf = SAMPLE_RATE * 2;
                int bufSize = Math.max(minBuf, SAMPLE_RATE);

                track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build())
                    .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build())
                    .setBufferSizeInBytes(bufSize)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();

                sirenTrack = track;
                track.setVolume(AudioTrack.getMaxVolume());
                track.play();

                short[] chunk = new short[SAMPLE_RATE / 10];
                double phase = 0.0;
                double t     = 0.0;

                while (sirenRunning) {
                    for (int i = 0; i < chunk.length; i++) {
                        double sweep = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / SWEEP_PERIOD);
                        double freq  = FREQ_LOW + (FREQ_HIGH - FREQ_LOW) * sweep;
                        phase += 2 * Math.PI * freq / SAMPLE_RATE;
                        if (phase > 2 * Math.PI * 1000) phase -= 2 * Math.PI * 1000;
                        double s = (Math.sin(phase) * 0.75 + Math.sin(phase * 3) * 0.25) * GAIN;
                        if (s >  1.0) s =  1.0;
                        if (s < -1.0) s = -1.0;
                        chunk[i] = (short) (s * 32767);
                        t += 1.0 / SAMPLE_RATE;
                    }
                    if (!sirenRunning) break;
                    track.write(chunk, 0, chunk.length);
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                try {
                    if (track != null) {
                        track.pause();
                        track.flush();
                        track.stop();
                        track.release();
                    }
                } catch (Exception ignored) {}
                sirenTrack = null;
            }
        }, "sos-siren-fg");

        sirenThread.setPriority(Thread.MAX_PRIORITY);
        sirenThread.start();
    }

    private static void stopSiren() {
        sirenRunning = false;
        try {
            if (sirenTrack != null) {
                sirenTrack.pause();
                sirenTrack.flush();
            }
        } catch (Exception ignored) {}
        try {
            if (sirenThread != null) {
                sirenThread.join(500);
                sirenThread = null;
            }
        } catch (Exception ignored) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Vibration — SOS morse pattern (· · ·  – – –  · · ·), repeating
    // ─────────────────────────────────────────────────────────────────────────
    private void startVibration() {
        try {
            vibrator = getVibrator(getApplicationContext());
            if (vibrator == null) return;

            long[] pattern = {
                0,   200, 100, 200, 100, 200,   // S  · · ·
                300, 500, 100, 500, 100, 500,   // O  – – –
                300, 200, 100, 200, 100, 200,   // S  · · ·
                800
            };

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

    // ─────────────────────────────────────────────────────────────────────────
    //  Static helpers
    // ─────────────────────────────────────────────────────────────────────────
    public static void cutAudio() {
        stopSiren();
    }

    public static void stopService(Context context) {
        if (context == null) return;
        try {
            stopSiren();
            Intent intent = new Intent(context, SOSSirenService.class);
            intent.setAction(ACTION_STOP);
            context.stopService(intent);
        } catch (Exception e) { e.printStackTrace(); }
    }
}
