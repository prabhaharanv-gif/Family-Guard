package com.scoopfamily.familyguard;

import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * What happens between a gesture being recognised and an alert going out.
 *
 * Shared by every native trigger, so the grace window, the cooldown and the
 * cancel path behave identically no matter which gesture fired. Detectors are
 * responsible only for recognising their own gesture; they call {@link #arm}
 * and this takes it from there.
 *
 * The grace window
 * ----------------
 * Recognising the gesture does not send anything. It arms the send and starts a
 * GRACE_MS countdown, shown as a notification carrying Cancel and announced by
 * a vibration, because the phone is usually in a pocket with the screen off.
 * Cancelling inside that window sends nothing at all — materially better than
 * the post-send Cancel in SosCancelReceiver, where the family has already been
 * woken and all that can be withdrawn is the alert.
 */
final class SosArming {

    private static final String TAG = "SOS_Arming";

    /** How long the user has to take it back before anything is sent. */
    static final long GRACE_MS = 3000;
    /** Silence after a send, so one gesture cannot raise several alerts. */
    static final long COOLDOWN_MS = 60_000;

    // Static because the countdown outlives the call that started it and is
    // cancelled from SosCancelReceiver, which the system instantiates fresh each
    // time. Everything here runs on the main thread, so plain statics suffice.
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static volatile boolean armed       = false;
    private static volatile long    lastFiredAt = 0;

    private SosArming() {}

    /** True while the cooldown after a send is still running. */
    static boolean inCooldown(long now) {
        return now - lastFiredAt < COOLDOWN_MS;
    }

    /** Milliseconds left on the cooldown; for logging. */
    static long cooldownRemaining(long now) {
        return COOLDOWN_MS - (now - lastFiredAt);
    }

    /**
     * Starts the countdown. Nothing leaves the phone until it runs out.
     *
     * @param source recorded in the log so one trigger can be told from another.
     */
    static void arm(final Context ctx, final String source) {
        if (armed) return;
        armed = true;
        lastFiredAt = System.currentTimeMillis();

        Log.w(TAG, source + " recognised — arming SOS, " + (GRACE_MS / 1000) + "s to cancel");

        // Felt before anything is shown. The screen is usually off and the
        // phone in a pocket, so this buzz is the only thing telling someone who
        // triggered it by accident that they have a few seconds to stop it.
        buzz(ctx, new long[] { 0, 120, 100, 120, 100, 120 });

        tick(ctx, source, (int) (GRACE_MS / 1000));
    }

    /** Counts down one second at a time, then sends. */
    private static void tick(final Context ctx, final String source, final int secondsLeft) {
        if (secondsLeft <= 0) {
            // Past the point of no return. Clearing `armed` here means a Cancel
            // tapped in the same instant is ignored — the receipt that follows
            // carries its own Cancel, which withdraws the alert instead.
            armed = false;
            SosCancelReceiver.showSending(ctx);
            fire(ctx, source);
            return;
        }
        SosCancelReceiver.showCountdown(ctx, secondsLeft);
        HANDLER.postDelayed(() -> tick(ctx, source, secondsLeft - 1), 1000);
    }

    /**
     * Called by SosCancelReceiver when Cancel is tapped inside the grace
     * window. No-op once the send has started.
     *
     * @return true if a pending send was stopped.
     */
    static boolean abortPending(Context ctx) {
        if (!armed) return false;
        armed = false;
        // Only this class posts to HANDLER, so clearing it wholesale cannot
        // touch anything else on the main looper.
        HANDLER.removeCallbacksAndMessages(null);
        SosCancelReceiver.dismiss(ctx);
        // The cooldown exists to stop a pocket sending a stream of alerts. A
        // cancel is a deliberate human act, so it also clears the way for an
        // immediate real attempt rather than locking the gesture out for a
        // minute right when it might be needed.
        lastFiredAt = 0;
        buzz(ctx, new long[] { 0, 60 });
        Log.w(TAG, "SOS cancelled inside the grace window — nothing was sent");
        return true;
    }

    private static void fire(final Context ctx, final String source) {
        // Confirms in the hand that the alert is actually going.
        buzz(ctx, new long[] { 0, 400, 200, 400 });

        new Thread(() -> {
            Location loc = LocationForegroundService.getLastKnownLocation();
            String sosId = SosSender.send(ctx, loc, source);
            Log.i(TAG, sosId != null ? "SOS delivered" : "SOS could not be delivered");
            // Posted either way. On success it carries Cancel; on failure it
            // says so, because a gesture that silently did nothing in an
            // emergency is the worst outcome available.
            SosCancelReceiver.showSent(ctx, sosId);
        }, "sos-gesture-send").start();
    }

    static void buzz(Context ctx, long[] pattern) {
        try {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
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
