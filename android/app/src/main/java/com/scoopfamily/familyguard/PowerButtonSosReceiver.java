package com.scoopfamily.familyguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Raises an SOS on three power presses. NOT CURRENTLY REGISTERED — the live
 * gesture is VolumeSosGesture. Kept because the reasoning below was expensive
 * to learn and would otherwise be rediscovered the hard way.
 *
 * Why it was retired
 * ------------------
 * Four separate problems, all confirmed on the Redmi (Android 12, MIUI):
 *
 *   · Easy to trigger by accident in a pocket.
 *   · Hard to land when actually needed. An app cannot see KEYCODE_POWER —
 *     Android never delivers it — so this watches the side effect instead:
 *     every press toggles the screen. Those broadcasts arrived 631–1042ms
 *     apart when pressing as fast as a hand can go, and runs died constantly
 *     on gaps of 2119ms and 3303ms.
 *   · Visible. Three screen flashes are obvious to anyone watching, which is
 *     wrong for an alert meant to be discreet.
 *   · One press away from dialling the emergency services. Five rapid presses
 *     is MIUI's own Emergency SOS and, with emergency_affordance_needed=1 as
 *     it is in India, calls 112. Raising the count to five was tried and the
 *     phone called 112 instead: the fifth press stops toggling the screen and
 *     starts the emergency dialer, so this class never even sees it. Logs
 *     reached 4/5 twice, then sat through a 4457ms hole.
 *
 * Do not raise the count to five. See VolumeSosGesture for what replaced it and
 * why a direction reversal solves all four problems at once.
 *
 * To re-enable, register it for ACTION_SCREEN_ON / ACTION_SCREEN_OFF from
 * something already running — those two cannot be declared in the manifest.
 * LocationForegroundService is the only thing alive while the app is closed.
 */
public class PowerButtonSosReceiver extends BroadcastReceiver {

    private static final String TAG = "SOS_PowerGesture";

    /** Screen transitions needed. Three; never five, for the reason above. */
    private static final int  PRESSES_TO_TRIGGER = 3;
    /** All of them must land inside this, and no single gap may exceed it. */
    private static final long WINDOW_MS  = 3000;
    /** Closer than this and it is one press reported twice, not two presses. */
    private static final long MIN_GAP_MS = 180;

    private final long[] presses = new long[PRESSES_TO_TRIGGER];
    private int count = 0;

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
        if (SosArming.inCooldown(now)) {
            Log.d(TAG, what + " ignored — cooldown, "
                     + (SosArming.cooldownRemaining(now) / 1000) + "s left");
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
            Log.d(TAG, PRESSES_TO_TRIGGER + " reached but spanned " + span
                     + "ms, over the " + WINDOW_MS + "ms window");
            return;
        }

        SosArming.arm(context.getApplicationContext(), "power-button-x" + PRESSES_TO_TRIGGER);
    }
}
