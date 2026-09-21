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
        arm(ctx, source, GRACE_MS, false);
    }

    /**
     * @param graceMs     the countdown for this trigger. The shake gesture uses a
     *                    longer one: a shake is easier to set off by accident
     *                    than a deliberate press pattern.
     * @param allFamilies send to every family the member is in, not only the
     *                    active one. Someone raising an SOS from a pocket has no
     *                    way to choose.
     */
    static void arm(final Context ctx, final String source, long graceMs, final boolean allFamilies) {
        if (armed) return;
        armed = true;
        lastFiredAt = System.currentTimeMillis();
        freshFix = null;

        Log.w(TAG, source + " recognised — arming SOS, " + (graceMs / 1000) + "s to cancel");

        // Felt before anything is shown. The screen is usually off and the
        // phone in a pocket, so this buzz is the only thing telling someone who
        // triggered it by accident that they have a few seconds to stop it.
        // Long pulses, not taps: a short tick is lost in the hand that has just
        // been shaking the phone.
        buzz(ctx, new long[] { 0, 300, 150, 300, 150, 300 });

        requestFreshFix(ctx);
        // The notification alone is not reachable in five seconds when the app is
        // open — MIUI keeps it in the shade. This takes the screen instead.
        SosCountdownActivity.show(ctx, graceMs);
        tick(ctx, source, (int) (graceMs / 1000), allFamilies);
    }

    /** Counts down one second at a time, then sends. */
    private static void tick(final Context ctx, final String source, final int secondsLeft,
                             final boolean allFamilies) {
        if (secondsLeft <= 0) {
            // Past the point of no return. Clearing `armed` here means a Cancel
            // tapped in the same instant is ignored — the receipt that follows
            // carries its own Cancel, which withdraws the alert instead.
            armed = false;
            SosCountdownActivity.finishIfShowing();
            SosCancelReceiver.showSending(ctx);
            fire(ctx, source, allFamilies);
            return;
        }
        SosCancelReceiver.showCountdown(ctx, secondsLeft);
        // One pulse per remaining second, so the countdown is felt as well as
        // shown — the phone may still be in a pocket.
        buzz(ctx, new long[] { 0, 90 });
        HANDLER.postDelayed(() -> tick(ctx, source, secondsLeft - 1, allFamilies), 1000);
    }

    /** A fix taken during the countdown, when one arrives in time. */
    private static volatile Location freshFix = null;

    /**
     * Asks for a current position the moment the SOS is armed, so the countdown
     * doubles as time to get one. The last pushed position can be minutes old —
     * or null after a restart, which sends the alert with no position at all.
     */
    private static void requestFreshFix(Context ctx) {
        try {
            com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(ctx)
                .getCurrentLocation(com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
                    new com.google.android.gms.tasks.CancellationTokenSource().getToken())
                .addOnSuccessListener(loc -> {
                    if (loc != null) {
                        freshFix = loc;
                        Log.i(TAG, "fresh fix for the SOS, accuracy " + loc.getAccuracy() + "m");
                    }
                });
        } catch (SecurityException e) {
            Log.w(TAG, "no location permission for a fresh fix: " + e.getMessage());
        } catch (Exception e) {
            Log.w(TAG, "fresh fix request failed: " + e.getMessage());
        }
    }

    /** The fresh fix when it is at least as good as the last pushed one, else the last pushed one. */
    private static Location bestFix() {
        Location fresh = freshFix;
        Location last  = LocationForegroundService.getLastKnownLocation();
        if (fresh == null) return last;
        if (last == null || fresh.getAccuracy() <= Math.max(last.getAccuracy(), 100f)) return fresh;
        return last;
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
        SosCountdownActivity.finishIfShowing();
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

    private static void fire(final Context ctx, final String source, final boolean allFamilies) {
        // Confirms in the hand that the alert is actually going. Unmistakably
        // longer than the countdown pulses: this is the moment that cannot be
        // taken back without the family already having been woken.
        buzz(ctx, new long[] { 0, 700, 250, 700 });

        new Thread(() -> {
            Location loc = bestFix();
            String sosId = allFamilies
                ? SosSender.sendAllFamilies(ctx, loc, source)
                : SosSender.send(ctx, loc, source);
            Log.i(TAG, sosId != null ? "SOS delivered" : "SOS could not be delivered");
            // The family is about to start calling. Keep this phone from
            // ringing in case its owner is hiding. See SosSilence.
            if (sosId != null) SosSilence.enter(ctx);
            // Posted either way. On success it carries Cancel; on failure it
            // says so, because a gesture that silently did nothing in an
            // emergency is the worst outcome available.
            SosCancelReceiver.showSent(ctx, sosId);
        }, "sos-gesture-send").start();
    }

    /**
     * The only signal that an SOS is on its way when the phone is in a pocket,
     * so it is sent as an ALARM rather than an unclassified buzz: that is what
     * survives silent mode, Do Not Disturb, and the system deciding a
     * background app's vibration can be dropped.
     *
     * VibratorManager on API 31+ for the same reason the call ringer uses it —
     * the legacy VIBRATOR_SERVICE has behaved differently on this MIUI build.
     */
    static void buzz(Context ctx, long[] pattern) {
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager vm = (android.os.VibratorManager)
                    ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v == null || !v.hasVibrator()) {
                Log.w(TAG, "no vibrator available");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.media.AudioAttributes alarm = new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                v.vibrate(VibrationEffect.createWaveform(pattern, -1), alarm);
            } else {
                v.vibrate(pattern, -1);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not vibrate: " + e.getMessage());
        }
    }
}
