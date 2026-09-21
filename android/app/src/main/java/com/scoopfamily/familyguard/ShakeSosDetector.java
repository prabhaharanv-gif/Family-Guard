package com.scoopfamily.familyguard;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.TriggerEvent;
import android.hardware.TriggerEventListener;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.util.Log;

/**
 * Raises an SOS when the phone is shaken hard for a little over a second.
 *
 * Started by LocationForegroundService, only while the member has switched
 * "Shake for SOS" on — the one component alive with the app closed. Recognition
 * lives in ShakePattern; this class owns the sensor, the sleep problem, and the
 * hand-off to SosArming (5 s countdown with Cancel, then every family).
 *
 * The sleep problem
 * -----------------
 * The test phone (Redmi, sc7a20) has no wake-up accelerometer. With the screen
 * off the processor sleeps between the location service's own wake-ups, and a
 * non-wake-up sensor does not wake it. Two things are done about that:
 *
 *  · The sensor is registered with a report latency, so samples taken while the
 *    processor sleeps are held in the sensor's FIFO (10,000 events on the Redmi)
 *    and delivered at the next wake-up with their real timestamps. ShakePattern
 *    is fed those timestamps, not arrival times, so a late batch is judged as
 *    the motion it was. The cost is delay, not a missed shake.
 *  · The significant-motion sensor IS a wake-up sensor. When it fires, a short
 *    wake lock keeps samples arriving in real time for LISTEN_AFTER_MOTION_MS.
 *
 * How well this works in a pocket is measured, not assumed: every STATS_MS the
 * sample count, the largest gap and the screen state go to the log.
 */
final class ShakeSosDetector implements SensorEventListener {

    private static final String TAG = "SOS_Shake";

    /** 100 Hz: fast enough that handlebar vibration cannot alias into a "shake". */
    private static final int  SAMPLING_US       = 10_000;
    /** Batches may be held this long while awake; longer while asleep (FIFO). */
    private static final int  REPORT_LATENCY_US = 500_000;
    /** The shake gesture's countdown before anything is sent. */
    static final long         GRACE_MS          = 5_000;
    private static final long LISTEN_AFTER_MOTION_MS = 45_000;
    private static final long STATS_MS          = 15_000;

    private final Context ctx;
    private final SensorManager sensors;
    private final PowerManager power;
    private final ShakePattern pattern = new ShakePattern();

    private HandlerThread thread;
    private Handler handler;
    private Sensor accel, motion;
    private PowerManager.WakeLock listenLock;

    private int  samples = 0;
    private long maxGapMs = 0, lastSampleMs = 0;
    private float peakG = 0f;
    private int   peakStrokes = 0;
    private long  attemptLoggedAt = 0;

    private final TriggerEventListener onMotion = new TriggerEventListener() {
        @Override public void onTrigger(TriggerEvent event) {
            Log.i(TAG, "significant motion — listening in real time for "
                + (LISTEN_AFTER_MOTION_MS / 1000) + "s");
            holdAwake();
            armMotionTrigger();   // one-shot: re-arm
        }
    };

    private final Runnable stats = new Runnable() {
        @Override public void run() {
            Log.i(TAG, "samples=" + samples + " in " + (STATS_MS / 1000) + "s, maxGap=" + maxGapMs
                + "ms, screenOn=" + (power != null && power.isInteractive())
                + ", listening=" + (listenLock != null && listenLock.isHeld()));
            samples = 0;
            maxGapMs = 0;
            if (handler != null) handler.postDelayed(this, STATS_MS);
        }
    };

    ShakeSosDetector(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.sensors = (SensorManager) this.ctx.getSystemService(Context.SENSOR_SERVICE);
        this.power = (PowerManager) this.ctx.getSystemService(Context.POWER_SERVICE);
    }

    boolean isRunning() { return thread != null; }

    void start() {
        if (thread != null) return;
        if (sensors == null || (accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)) == null) {
            Log.w(TAG, "No accelerometer — shake SOS unavailable");
            return;
        }
        thread = new HandlerThread("sos-shake");
        thread.start();
        handler = new Handler(thread.getLooper());

        boolean ok = sensors.registerListener(this, accel, SAMPLING_US, REPORT_LATENCY_US, handler);
        motion = sensors.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION);
        armMotionTrigger();
        handler.postDelayed(stats, STATS_MS);

        Log.i(TAG, "shake SOS armed: accelerometer " + (ok ? "registered" : "REFUSED")
            + " (" + accel.getName() + ", wakeUp=" + accel.isWakeUpSensor()
            + ", fifo=" + accel.getFifoMaxEventCount() + "), significantMotion=" + (motion != null));
    }

    void stop() {
        if (thread == null) return;
        try { sensors.unregisterListener(this); } catch (Exception ignored) {}
        if (motion != null) {
            try { sensors.cancelTriggerSensor(onMotion, motion); } catch (Exception ignored) {}
        }
        releaseAwake();
        handler.removeCallbacksAndMessages(null);
        thread.quitSafely();
        thread = null;
        handler = null;
        pattern.reset();
        Log.i(TAG, "shake SOS stopped");
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        // The capture time, not the delivery time: batches from the FIFO arrive
        // late and all at once.
        long t = e.timestamp / 1_000_000L;
        samples++;
        if (lastSampleMs != 0 && t > lastSampleMs) maxGapMs = Math.max(maxGapMs, t - lastSampleMs);
        lastSampleMs = t;

        boolean armed = pattern.sample(t, e.values[0], e.values[1], e.values[2]);

        // How close a shake came, so a gesture that never fires can be diagnosed
        // from a log instead of guessed at. Throttled, and only while moving.
        float mag = pattern.lastMagG();
        if (mag > peakG) peakG = mag;
        int st = pattern.strokes();
        if (st > peakStrokes) peakStrokes = st;
        if (peakG > 0.8f && t - attemptLoggedAt > 1500) {
            attemptLoggedAt = t;
            Log.d(TAG, "motion: peak=" + String.format(java.util.Locale.US, "%.2f", peakG)
                + "g strokes=" + peakStrokes + "/" + ShakePattern.STROKES_TO_ARM
                + " (need " + ShakePattern.STROKE_G + "g per stroke)");
            peakG = 0f;
            peakStrokes = 0;
        }

        if (!armed) return;

        long now = System.currentTimeMillis();
        if (SosArming.inCooldown(now)) {
            Log.i(TAG, "shake recognised but ignored — cooldown, "
                + (SosArming.cooldownRemaining(now) / 1000) + "s left");
            return;
        }
        long lagMs = android.os.SystemClock.elapsedRealtime() - t;
        Log.w(TAG, "shake recognised (" + lagMs + "ms after it happened) — arming SOS");
        // SosArming keeps its state on the main thread; this is the sensor thread.
        new Handler(android.os.Looper.getMainLooper())
            .post(() -> SosArming.arm(ctx, "shake", GRACE_MS, true));
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void armMotionTrigger() {
        if (motion == null) return;
        try {
            sensors.requestTriggerSensor(onMotion, motion);
        } catch (Exception e) {
            Log.w(TAG, "significant motion unavailable: " + e.getMessage());
        }
    }

    private void holdAwake() {
        try {
            if (listenLock == null) {
                listenLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Famora::ShakeListen");
                listenLock.setReferenceCounted(false);
            }
            listenLock.acquire(LISTEN_AFTER_MOTION_MS);
            // Deliver what the FIFO is holding now rather than at the next batch.
            sensors.flush(this);
        } catch (Exception e) {
            Log.w(TAG, "could not hold awake: " + e.getMessage());
        }
    }

    private void releaseAwake() {
        try { if (listenLock != null && listenLock.isHeld()) listenLock.release(); } catch (Exception ignored) {}
    }
}
