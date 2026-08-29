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
 * Foreground service that rings this phone for "Find My Device".
 *
 * Structure deliberately mirrors SOSSirenService — same WakeLock-first
 * ordering (MIUI/ColorOS can suspend the process between onMessageReceived()
 * returning and startForeground() completing), same AudioTrack-on-USAGE_ALARM
 * approach so it is audible on a silenced phone.
 *
 * Differences from the SOS siren, all deliberate:
 *   - No full-screen intent and no specialUse FGS type. A ping is not an
 *     emergency: it must be loud, but it must not seize the lock screen.
 *   - Distinct audio. The SOS siren is a continuous 600->1600 Hz wail; this is
 *     an alternating two-tone chirp, so the two are never confused by ear.
 *   - 30 s auto-stop (vs 60 s) plus a Stop action on the notification, since
 *     whoever finds the phone is the one who silences it.
 */
public class PingRingService extends Service {

    public  static final String ACTION_STOP   = "com.scoopfamily.familyguard.STOP_PING_RING";
    private static final int    FOREGROUND_ID = 9311;

    // IMPORTANCE_HIGH for the heads-up banner, setSound(null) because the
    // AudioTrack below is the only audio source — a channel sound here would
    // play over the chirp and be cut short when the service stops.
    public  static final String PING_CHANNEL_ID   = "find_my_device_v1";
    private static final String PING_CHANNEL_NAME = "Find My Device";

    private static final long RING_DURATION_MS = 30_000L;

    // Read by PingAlarmPlugin so the web layer can silence a ring in progress.
    public static volatile boolean isRunning = false;

    private static volatile boolean chirpRunning = false;
    private static Thread     chirpThread = null;
    private static AudioTrack chirpTrack  = null;

    private Vibrator vibrator = null;
    private PowerManager.WakeLock wakeLock       = null;
    private PowerManager.WakeLock screenWakeLock = null;

    // ─────────────────────────────────────────────────────────────────────────
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            releaseWakeLock();
            stopChirp();
            cancelVibration();
            stopSelf();
            return START_NOT_STICKY;
        }

        acquireWakeLock();

        String senderName = (intent != null) ? intent.getStringExtra("sender") : null;
        if (senderName == null || senderName.isEmpty()) senderName = "A family member";

        isRunning = true;

        ensurePingChannelStatic(getApplicationContext());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {  // API 29
            startForeground(
                FOREGROUND_ID,
                buildForegroundNotification(senderName),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(FOREGROUND_ID, buildForegroundNotification(senderName));
        }

        // Restarting is safe — startChirp() stops any existing ring first, so a
        // second ping while one is already ringing gives one continuous chirp
        // rather than two overlapping copies.
        startChirp();
        startVibration();

        // Wake the display so the phone is visible as well as audible — the
        // whole point is finding it in a dark room or under a cushion.
        forceScreenOn();

        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> {
                releaseWakeLock();
                stopChirp();
                cancelVibration();
                stopSelf();
            }, RING_DURATION_MS);

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        stopChirp();
        cancelVibration();
        isRunning = false;
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
                "Famora::PingRingWakeLock"
            );
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(RING_DURATION_MS + 5_000L);
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

    /** Same deprecated-but-only-reliable screen wake used by SOSSirenService. */
    @SuppressWarnings("deprecation")
    private void forceScreenOn() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            screenWakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "Famora::PingScreenWakeLock"
            );
            screenWakeLock.setReferenceCounted(false);
            screenWakeLock.acquire(10_000L);
        } catch (Exception e) { e.printStackTrace(); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Notification — banner + a Stop action that kills the ring
    // ─────────────────────────────────────────────────────────────────────────
    private Notification buildForegroundNotification(String senderName) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, PingRingService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
            this, 3, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, PING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(android.graphics.Color.parseColor("#951345"))
            .setContentTitle("📡 Found it!")
            .setContentText(senderName + " is looking for this phone")
            .setStyle(new NotificationCompat.BigTextStyle()
                .bigText(senderName + " is looking for this phone.\n\nTap Stop to silence it."))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentPi)
            .addAction(0, "Stop", stopPi)
            .build();
    }

    public static void ensurePingChannelStatic(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(PING_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            PING_CHANNEL_ID, PING_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription("Rings this phone when a family member uses Find My Device");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Synthesized two-tone locator chirp
    // ─────────────────────────────────────────────────────────────────────────
    private void startChirp() {
        stopChirp();

        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setStreamVolume(AudioManager.STREAM_ALARM,
                    am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (Exception e) { e.printStackTrace(); }

        chirpRunning = true;
        chirpThread  = new Thread(() -> {
            final int    SAMPLE_RATE = 44100;
            final double FREQ_HIGH   = 1046.5;  // C6
            final double FREQ_LOW    = 784.0;   // G5
            final double BEEP_SEC    = 0.28;
            final double GAP_SEC     = 0.14;
            // Matches SOSSirenService: the 0.75/0.25 harmonic mix peaks at 1.0,
            // so anything above ~0.92 clips into buzz instead of getting louder.
            final double GAIN        = 0.92;
            // 8 ms raised-cosine edges. Without them each beep starts and ends on
            // a step discontinuity, which is an audible click on every repeat.
            final double EDGE_SEC    = 0.008;

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

                chirpTrack = track;
                track.setVolume(AudioTrack.getMaxVolume());
                track.play();

                final int beepSamples = (int) (BEEP_SEC * SAMPLE_RATE);
                final int gapSamples  = (int) (GAP_SEC  * SAMPLE_RATE);
                final int edgeSamples = (int) (EDGE_SEC * SAMPLE_RATE);

                short[] beepHigh = new short[beepSamples];
                short[] beepLow  = new short[beepSamples];
                short[] silence  = new short[gapSamples];

                fillBeep(beepHigh, FREQ_HIGH, SAMPLE_RATE, GAIN, edgeSamples);
                fillBeep(beepLow,  FREQ_LOW,  SAMPLE_RATE, GAIN, edgeSamples);

                boolean high = true;
                while (chirpRunning) {
                    track.write(high ? beepHigh : beepLow, 0, beepSamples);
                    if (!chirpRunning) break;
                    track.write(silence, 0, gapSamples);
                    high = !high;
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
                chirpTrack = null;
            }
        }, "ping-chirp-fg");

        chirpThread.setPriority(Thread.MAX_PRIORITY);
        chirpThread.start();
    }

    /** One beep at {@code freq}, with raised-cosine fade in/out to avoid clicks. */
    private static void fillBeep(short[] out, double freq, int sampleRate,
                                 double gain, int edgeSamples) {
        for (int i = 0; i < out.length; i++) {
            double phase = 2 * Math.PI * freq * i / sampleRate;
            double s = (Math.sin(phase) * 0.75 + Math.sin(phase * 3) * 0.25) * gain;

            double env = 1.0;
            if (edgeSamples > 0) {
                if (i < edgeSamples) {
                    env = 0.5 - 0.5 * Math.cos(Math.PI * i / edgeSamples);
                } else if (i >= out.length - edgeSamples) {
                    env = 0.5 - 0.5 * Math.cos(Math.PI * (out.length - 1 - i) / edgeSamples);
                }
            }
            s *= env;

            if (s >  1.0) s =  1.0;
            if (s < -1.0) s = -1.0;
            out[i] = (short) (s * 32767);
        }
    }

    private static void stopChirp() {
        chirpRunning = false;
        try {
            if (chirpTrack != null) {
                chirpTrack.pause();
                chirpTrack.flush();
            }
        } catch (Exception ignored) {}
        try {
            if (chirpThread != null) {
                chirpThread.join(500);
                chirpThread = null;
            }
        } catch (Exception ignored) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Vibration — short double-buzz, repeating
    // ─────────────────────────────────────────────────────────────────────────
    private void startVibration() {
        try {
            vibrator = getVibrator(getApplicationContext());
            if (vibrator == null) return;

            long[] pattern = { 0, 250, 150, 250, 700 };

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
    public static void stopService(Context context) {
        if (context == null) return;
        try {
            stopChirp();
            Intent intent = new Intent(context, PingRingService.class);
            intent.setAction(ACTION_STOP);
            context.stopService(intent);
        } catch (Exception e) { e.printStackTrace(); }
    }
}
