package com.scoopfamily.familyguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * Raises an SOS when the power button is pressed three times in quick
 * succession, with the app closed.
 *
 * Why it watches the screen rather than the button
 * ------------------------------------------------
 * Android never delivers KEYCODE_POWER to an app. The system consumes it, and
 * no permission or foreground state changes that. What an app can see is the
 * consequence: every press toggles the screen, so three presses arrive here as
 * three ACTION_SCREEN_ON / ACTION_SCREEN_OFF broadcasts.
 *
 * Those two actions cannot be declared in the manifest — Android ignores them
 * there — so this must be registered at runtime by something already running.
 * LocationForegroundService is that something. The practical consequence is
 * that the gesture only works while location sharing is on; with the service
 * stopped there is nothing alive to hear the screen change.
 *
 * Guarding against a false alarm
 * ------------------------------
 * A wrongly-sent SOS wakes a family, possibly at night, so the count is
 * deliberately hard to reach by accident:
 *
 *   · all three transitions must land inside WINDOW_MS
 *   · two transitions closer together than MIN_GAP_MS are treated as one
 *     physical press, since a single press can produce a doubled broadcast
 *   · the screen going off on its own timeout looks identical to a press, so
 *     the window is short enough that a timeout followed by an unlock cannot
 *     reach three on its own
 *   · after firing, COOLDOWN_MS must pass before another can be raised, so a
 *     phone loose in a pocket cannot send a stream of them
 */
public class PowerButtonSosReceiver extends BroadcastReceiver {

    private static final String TAG = "SOS_PowerGesture";

    /** Screen transitions needed. Three presses, as asked for. */
    private static final int  PRESSES_TO_TRIGGER = 3;
    /** All of them must land inside this. */
    private static final long WINDOW_MS   = 3000;
    /** Closer than this and it is one press reported twice, not two presses. */
    private static final long MIN_GAP_MS  = 180;
    /** Silence after a send, so one gesture cannot raise several alerts. */
    private static final long COOLDOWN_MS = 60_000;

    private final long[] presses = new long[PRESSES_TO_TRIGGER];
    private int  count       = 0;
    private long lastFiredAt = 0;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_SCREEN_ON.equals(action) && !Intent.ACTION_SCREEN_OFF.equals(action)) {
            return;
        }

        long now = System.currentTimeMillis();
        long gap = count > 0 ? now - presses[count - 1] : -1;
        String what = Intent.ACTION_SCREEN_ON.equals(action) ? "ON" : "OFF";

        // Every transition is logged, with the gap since the last one and the
        // reason it was or was not counted. Without this a gesture that failed
        // left no trace at all, and the three ways it can be dropped —
        // cooldown, too fast, too slow — are indistinguishable from the outside.
        if (now - lastFiredAt < COOLDOWN_MS) {
            Log.d(TAG, what + " ignored — cooldown, " + ((COOLDOWN_MS - (now - lastFiredAt)) / 1000) + "s left");
            return;
        }

        // Collapse a doubled broadcast into the single press it came from.
        if (count > 0 && gap < MIN_GAP_MS) {
            Log.d(TAG, what + " ignored — only " + gap + "ms since the last, treated as one press");
            return;
        }

        // Drop the run if this transition is too far from the previous one, and
        // start counting again from here — this press may be the first of a
        // real gesture.
        if (count > 0 && gap > WINDOW_MS) {
            Log.d(TAG, what + " — " + gap + "ms gap, too slow, restarting the count");
            count = 0;
        }

        presses[count] = now;
        count++;
        Log.d(TAG, what + " counted " + count + "/" + PRESSES_TO_TRIGGER
                 + (gap >= 0 ? " (+" + gap + "ms)" : ""));

        if (count < PRESSES_TO_TRIGGER) return;

        // A full run only counts if the whole thing happened inside the window.
        long span = now - presses[0];
        boolean inWindow = span <= WINDOW_MS;
        count = 0;
        if (!inWindow) {
            Log.d(TAG, "3 reached but spanned " + span + "ms, over the " + WINDOW_MS + "ms window");
            return;
        }

        lastFiredAt = now;
        Log.w(TAG, "Power pressed " + PRESSES_TO_TRIGGER + "x — raising SOS");
        fire(context.getApplicationContext());
    }

    private void fire(final Context ctx) {
        // Confirm in the hand before anything else. The phone is likely in a
        // pocket with the screen off, and someone who has just triggered this
        // deliberately needs to know it worked without looking; someone who
        // triggered it by accident needs to know it happened at all.
        buzz(ctx);

        new Thread(() -> {
            Location loc = LocationForegroundService.getLastKnownLocation();
            String sosId = SosSender.send(ctx, loc, "power-button-x" + PRESSES_TO_TRIGGER);
            Log.i(TAG, sosId != null ? "SOS delivered" : "SOS could not be delivered");
            // Posted either way. On success it carries Cancel; on failure it
            // says so, because a gesture that silently did nothing in an
            // emergency is the worst outcome available.
            SosCancelReceiver.showSent(ctx, sosId);
        }, "sos-power-gesture").start();
    }

    private void buzz(Context ctx) {
        try {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            long[] pattern = { 0, 400, 200, 400 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                v.vibrate(pattern, -1);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not vibrate: " + e.getMessage());
        }
    }
}
