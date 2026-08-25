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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that owns the SOS siren and vibration.
 *
 * Why a foreground service?
 * ─────────────────────────
 * When onMessageReceived() is called for an FCM data message (app alive but
 * backgrounded, or app freshly woken by a high-priority data message),
 * Android grants a short WakeLock that lasts only until onMessageReceived()
 * returns. Any plain Thread started there is killed moments later, before
 * AudioTrack has produced a single sample.
 *
 * A foreground service with startForeground() keeps the process alive and
 * audio-focused for as long as we need it (up to the 60-second auto-stop).
 *
 * Starting a foreground service from a high-priority FCM handler is explicitly
 * allowed on all Android versions — it is one of the documented exemptions to
 * the "no background foreground service start" rules in Android 12+/14+.
 */
public class SOSSirenService extends Service {

    public  static final String ACTION_STOP        = "com.scoopfamily.familyguard.STOP_SIREN";
    private static final int    FOREGROUND_ID      = 9112;
    private static final int    SOS_POPUP_NOTIF_ID = 9113;

    // Silent-but-high-importance channel for the heads-up banner.
    // IMPORTANCE_HIGH = shows as peek banner. setSound(null) = no channel melody
    // (AudioTrack in startSiren() provides the only audio).
    // This is separate from sos_alerts_v3 which had alarm sound for the old
    // killed-app channel-delivery path (now replaced by the foreground service).
    public  static final String SOS_POPUP_CHANNEL_ID   = "sos_popup_v1";
    private static final String SOS_POPUP_CHANNEL_NAME = "SOS Alert Banner";

    // ── Shared state — read by SOSAlarmPlugin and MainActivity ───────────────
    public static volatile boolean isRunning = false;

    // ── Audio state ─────────────────────────────────────────────────────────
    private static volatile boolean sirenRunning = false;
    private static Thread     sirenThread   = null;
    private static AudioTrack sirenTrack    = null;

    // ── Vibrator reference — needed to cancel vibration in onDestroy ─────────
    private Vibrator vibrator = null;

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        // A STOP action is sent by stopService(Context) so we clean up properly
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSiren();
            cancelVibration();
            stopSelf();
            return START_NOT_STICKY;
        }

        String senderName = (intent != null) ? intent.getStringExtra("sender")  : null;
        String message    = (intent != null) ? intent.getStringExtra("message") : null;
        if (senderName == null || senderName.isEmpty()) senderName = "A family member";
        if (message    == null || message.isEmpty())    message    = "SOS Alert";

        isRunning = true;

        // ── Must call startForeground within 5 s of onStartCommand ──────────
        // Use the silent-but-IMPORTANCE_HIGH popup channel so the foreground
        // notification appears as a heads-up banner (setSilent suppresses banners,
        // so we use a channel with null sound instead and skip setSilent entirely).
        ensureSosPopupChannelStatic(getApplicationContext());
        startForeground(FOREGROUND_ID, buildForegroundNotification(senderName, message));

        startSiren();
        startVibration();

        // Safety net: auto-stop after 60 s even if the user never responds
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> {
                stopSiren();
                cancelVibration();
                stopSelf();
            }, 60_000L);

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopSiren();
        cancelVibration();
        isRunning = false;

        // Cancel both the FCM-generated notification and the popup notification.
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
    //  Foreground notification — shown while siren is active.
    //  Posted on sos_popup_v1 (IMPORTANCE_HIGH, null sound) so it appears as a
    //  heads-up banner WITHOUT playing any extra channel sound.
    //  setSilent is intentionally omitted: the channel has no sound, so there
    //  is nothing to silence — and setSilent would also suppress the banner.
    // ─────────────────────────────────────────────────────────────────────────
    private Notification buildForegroundNotification(String senderName, String message) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("sos_notification", true);

        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, SOS_POPUP_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("🚨 SOS — " + senderName + " needs help!")
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle()
                .bigText("⚠️ " + senderName + " needs help!\n\n"
                       + message + "\n\nTap to open FamilyGuard."))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)           // cannot be swiped away
            .setAutoCancel(false)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)  // wakes screen / full-screen on lock
            .build();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Popup channel — IMPORTANCE_HIGH so Android shows the heads-up banner,
    //  but sound is null so only our AudioTrack plays (no channel melody).
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
        ch.setSound(null, null);      // no channel sound; siren thread plays audio
        ch.enableVibration(false);    // vibration handled directly in startVibration()
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Synthesized emergency siren — identical waveform to the original but
    //  now lives in a foreground service so it cannot be killed mid-play.
    //
    //  600 Hz → 1600 Hz → 600 Hz wail every 0.7 s, with a 3rd harmonic.
    // ─────────────────────────────────────────────────────────────────────────
    private void startSiren() {
        stopSiren();  // never stack two sirens

        // Force alarm stream to max volume
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
            final double GAIN         = 1.35;

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

                short[] chunk = new short[SAMPLE_RATE / 10];   // 0.1 s per write
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
                    track.write(chunk, 0, chunk.length);  // blocking in STREAM mode
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
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = loop
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
    //  Static helpers — called from SOSAlarmPlugin, MainActivity, and
    //  MyFirebaseMessagingService
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Instantly cuts audio without needing a Context.
     * Used by MyFirebaseMessagingService.stopSOSAlarm() for immediate silence.
     */
    public static void cutAudio() {
        stopSiren();
    }

    /**
     * Stop the siren service from any context (SOSAlarmPlugin, MainActivity, etc.).
     * Safe to call even if the service is not running — stopService is a no-op then.
     */
    public static void stopService(Context context) {
        if (context == null) return;
        try {
            // Cut audio immediately (doesn't wait for service lifecycle)
            stopSiren();
            // Then stop the service so vibration and foreground notification are cleared
            Intent intent = new Intent(context, SOSSirenService.class);
            intent.setAction(ACTION_STOP);
            context.stopService(intent);
        } catch (Exception e) { e.printStackTrace(); }
    }
}
