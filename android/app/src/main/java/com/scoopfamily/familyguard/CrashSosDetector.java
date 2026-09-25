package com.scoopfamily.familyguard;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;

/**
 * Starts an SOS countdown when a probable vehicle crash is recognised.
 *
 * Owned by LocationForegroundService and alive only while the member has
 * switched "Crash detection" on. Recognition is CrashPattern's; this class owns
 * the sensor and the hand-off to SosArming (a countdown with a loud Cancel —
 * nothing is sent until it runs out).
 *
 * Battery: the accelerometer is registered ONLY while the phone is travelling
 * at driving speed (per the GPS fixes the location service already receives),
 * plus a short tail, and released otherwise. A phone on a desk or in a walking
 * pocket pays nothing.
 */
final class CrashSosDetector implements SensorEventListener {

    private static final String TAG = "SOS_Crash";

    /** 100 Hz: an impact lasts tens of milliseconds. */
    private static final int  SAMPLING_US       = 10_000;
    private static final int  REPORT_LATENCY_US = 200_000;
    /** Keep listening this long after the last driving-speed fix. */
    private static final long TAIL_MS = 60_000L;
    /** Longer than a shake countdown: the person may be shaken up, and a loud
     *  Cancel is the only defence against a false alarm. */
    static final long GRACE_MS = 20_000L;

    private final Context ctx;
    private final SensorManager sensors;
    private final CrashPattern pattern = new CrashPattern();

    private HandlerThread thread;
    private Handler handler;
    private Sensor accel;
    private boolean listening = false;
    private long lastDrivingMs = 0;

    CrashSosDetector(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.sensors = (SensorManager) this.ctx.getSystemService(Context.SENSOR_SERVICE);
    }

    void start() {
        if (thread != null) return;
        if (sensors == null || (accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)) == null) {
            Log.w(TAG, "No accelerometer — crash detection unavailable");
            return;
        }
        thread = new HandlerThread("sos-crash");
        thread.start();
        handler = new Handler(thread.getLooper());
        Log.i(TAG, "crash detection armed (sensor runs only while driving)");
    }

    void stop() {
        if (thread == null) return;
        stopListening();
        handler.removeCallbacksAndMessages(null);
        thread.quitSafely();
        thread = null;
        handler = null;
        pattern.reset();
        Log.i(TAG, "crash detection stopped");
    }

    /** Called by the location service for every raw fix, on its own thread. */
    void onFix(Location loc) {
        if (thread == null || loc == null || !loc.hasSpeed()) return;
        long t = loc.getElapsedRealtimeNanos() / 1_000_000L;
        float kmh = loc.getSpeed() * 3.6f;

        boolean crash = pattern.onSpeed(t, kmh);
        if (pattern.drivingAt(t)) {
            lastDrivingMs = android.os.SystemClock.elapsedRealtime();
            startListening();
        } else if (listening && android.os.SystemClock.elapsedRealtime() - lastDrivingMs > TAIL_MS) {
            stopListening();
        }

        if (crash) {
            long now = System.currentTimeMillis();
            if (SosArming.inCooldown(now)) {
                Log.i(TAG, "crash recognised but ignored — SOS cooldown");
                return;
            }
            Log.w(TAG, "crash recognised (speed now " + Math.round(kmh) + " km/h) — arming SOS");
            new Handler(Looper.getMainLooper())
                .post(() -> SosArming.arm(ctx, "crash", GRACE_MS, true));
        }
    }

    private void startListening() {
        if (listening || sensors == null || accel == null || handler == null) return;
        listening = sensors.registerListener(this, accel, SAMPLING_US, REPORT_LATENCY_US, handler);
        Log.i(TAG, "driving speed — accelerometer " + (listening ? "on" : "REFUSED"));
    }

    private void stopListening() {
        if (!listening) return;
        try { sensors.unregisterListener(this); } catch (Exception ignored) {}
        listening = false;
        Log.i(TAG, "not driving — accelerometer off");
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long t = e.timestamp / 1_000_000L;
        pattern.onAccel(t, e.values[0], e.values[1], e.values[2]);
        float g = pattern.pendingImpactG();
        if (g > 0f) {
            // Tuning aid: how hard the jolt was, so a false alarm or a missed
            // one can be judged from a log rather than guessed at.
            Log.d(TAG, "impact candidate " + String.format(java.util.Locale.US, "%.1f", g) + " g");
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
