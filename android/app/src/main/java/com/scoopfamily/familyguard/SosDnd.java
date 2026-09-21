package com.scoopfamily.familyguard;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

/**
 * Do Not Disturb handling for an SOS alert.
 *
 * Why this exists
 * ───────────────
 * "The alarm doesn't sound when the phone is on silent" is two different
 * mechanisms wearing one name, and only one of them was ever handled:
 *
 *   - Ringer silent / vibrate (RINGER_MODE_SILENT). STREAM_ALARM is exempt from
 *     this by design, so the siren was always fine here. SOSSirenService's
 *     USAGE_ALARM routing plus raiseAlarmVolumeForAlert() covers it.
 *
 *   - Do Not Disturb (zen mode). This one mutes the alarm stream outright.
 *     ZenModeHelper applies an AppOps restriction on OP_PLAY_AUDIO for
 *     USAGE_ALARM whenever the filter is NONE, or PRIORITY without alarms
 *     allowed. Nothing an app can do to its own AudioTrack gets around that —
 *     the audio is stopped above the app. setStreamVolume(STREAM_ALARM, ...)
 *     additionally throws SecurityException while DND is on, so even the
 *     volume raise was quietly failing into SOSSirenService's catch block.
 *
 * So on a phone in DND the SOS produced a muted siren, a swallowed exception
 * and a notification that could not bypass anything. The alert was delivered
 * and nobody heard it.
 *
 * What this does
 * ──────────────
 * An SOS BORROWS the interruption filter for the length of the alert and hands
 * it straight back, exactly as raiseAlarmVolumeForAlert() borrows the alarm
 * volume. The saved value lives in SharedPreferences rather than a static:
 * MIUI kills this process mid-siren, and a static would leave the person's
 * phone stuck out of Do Not Disturb with no way back.
 *
 * All of it is gated on the user having granted Notification Policy Access.
 * The permission cannot be requested with requestPermissions() — it is a
 * Settings toggle — so SosReliabilitySetup asks for it as one more row, and
 * every method here no-ops when it is not held.
 */
final class SosDnd {

    private SosDnd() {}

    /** Saved interruption filter, or absent when an SOS is not borrowing it. */
    private static final String KEY_SAVED_FILTER = "sos_saved_dnd_filter";

    private static NotificationManager nm(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(
            MyFirebaseMessagingService.PREF_NAME, Context.MODE_PRIVATE);
    }

    /** True when the user has allowed Famora under Settings > Do Not Disturb access. */
    static boolean hasAccess(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            NotificationManager m = nm(ctx);
            return m != null && m.isNotificationPolicyAccessGranted();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Whether the current filter would mute a USAGE_ALARM siren.
     *
     * INTERRUPTION_FILTER_ALARMS lets alarms through, so it is NOT silencing.
     * PRIORITY depends on the alarms category in the active policy, which can
     * only be read with policy access — without it the honest answer is
     * unknown, and an unknown on a safety path resolves towards "assume the
     * siren will be muted" so the alert still tries to make itself heard.
     */
    static boolean isSilencingAlarms(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        try {
            NotificationManager m = nm(ctx);
            if (m == null) return false;

            int filter = m.getCurrentInterruptionFilter();
            switch (filter) {
                case NotificationManager.INTERRUPTION_FILTER_ALL:
                case NotificationManager.INTERRUPTION_FILTER_ALARMS:
                    return false;
                case NotificationManager.INTERRUPTION_FILTER_NONE:
                    return true;
                case NotificationManager.INTERRUPTION_FILTER_PRIORITY:
                    if (!hasAccess(ctx)) return true;   // unreadable → assume muted
                    NotificationManager.Policy p = m.getNotificationPolicy();
                    if (p == null) return true;
                    return (p.priorityCategories
                            & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) == 0;
                default:
                    // INTERRUPTION_FILTER_UNKNOWN and anything a future release adds.
                    return false;
            }
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Step out of Do Not Disturb for the duration of this alert.
     *
     * Call once per ALERT, not once per push — the paired restore() is what
     * puts the person's own setting back, and a second suspend would overwrite
     * the baseline with our own INTERRUPTION_FILTER_ALL. That is why the
     * baseline is only written when none survives, mirroring the alarm-volume
     * code next to it.
     *
     * @return true when the filter was actually changed.
     */
    static boolean suspendForAlert(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        if (!hasAccess(ctx)) return false;
        if (!isSilencingAlarms(ctx)) return false;

        try {
            NotificationManager m = nm(ctx);
            if (m == null) return false;

            int current = m.getCurrentInterruptionFilter();
            SharedPreferences sp = prefs(ctx);
            if (sp.getInt(KEY_SAVED_FILTER, -1) == -1) {
                sp.edit().putInt(KEY_SAVED_FILTER, current).apply();
            }

            m.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
            android.util.Log.i("FamoraSOS",
                "DND suspended for SOS (was filter " + current + ")");
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    /** Hand the person's Do Not Disturb setting back. Safe when nothing was suspended. */
    static void restore(Context ctx) {
        try {
            SharedPreferences sp = prefs(ctx);
            int saved = sp.getInt(KEY_SAVED_FILTER, -1);
            if (saved == -1) return;

            // Clear the baseline whatever happens below. A saved value that can
            // never be applied — access revoked mid-alert, say — would otherwise
            // block every later suspend from recording a real one.
            sp.edit().remove(KEY_SAVED_FILTER).apply();

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            if (!hasAccess(ctx)) return;
            NotificationManager m = nm(ctx);
            if (m != null) m.setInterruptionFilter(saved);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /** Settings screen where the user grants Do Not Disturb access. */
    static Intent accessSettingsIntent() {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }
}
