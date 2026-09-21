package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.util.Log;

/**
 * Hides the SENDER's phone while their SOS is open.
 *
 * Someone who raises an SOS may be hiding from the person they are running
 * from. The moment the alert goes out, their family starts calling them — and a
 * ringing phone gives away where they are. So sending an SOS switches this
 * phone to silent, and marking yourself safe puts the ringer back.
 *
 * Two layers, because the ringer alone is not enough:
 *
 *   1. The system ringer goes to RINGER_MODE_SILENT. That quiets ordinary
 *      phone calls, WhatsApp calls and every notification. It needs Do Not
 *      Disturb access (the same grant SosDnd uses, asked for in the
 *      reliability setup). Without it Android refuses SILENT, and VIBRATE is
 *      the closest thing an app is allowed to set.
 *
 *   2. Famora's own sounds that are built to get through a silenced phone
 *      check isActive() and stay quiet: the find-my-phone ping (USAGE_ALARM at
 *      full volume), the incoming-call ringer and its manual vibration (which
 *      also raises STREAM_RING and can knock the phone out of silent), and
 *      another family member's SOS siren (USAGE_ALARM, and it steps out of
 *      DND). Those screens still appear; they just make no sound.
 *
 * State lives in SharedPreferences, not a static: MIUI kills the process
 * freely, and forgetting that we changed the ringer would leave someone's
 * phone silent for good. For the same reason the silence expires by itself
 * after MAX_HOLD_MS. The web layer also clears it whenever it sees no open SOS
 * of this user's (SOSAlarm.exitSosSilence).
 */
final class SosSilence {

    private SosSilence() {}

    private static final String TAG = "FamoraSOS";

    private static final String KEY_ACTIVE      = "sos_silence_active";
    private static final String KEY_SINCE       = "sos_silence_since";
    private static final String KEY_SAVED_MODE  = "sos_silence_saved_ringer";
    private static final String KEY_SET_MODE    = "sos_silence_set_ringer";

    /** Longest the phone is held silent without a resolve arriving. */
    private static final long MAX_HOLD_MS = 12L * 60 * 60 * 1000;

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(
            MyFirebaseMessagingService.PREF_NAME, Context.MODE_PRIVATE);
    }

    /** True while this phone's own SOS is open and it should make no sound. */
    static boolean isActive(Context ctx) {
        if (ctx == null) return false;
        SharedPreferences sp = prefs(ctx);
        if (!sp.getBoolean(KEY_ACTIVE, false)) return false;
        long since = sp.getLong(KEY_SINCE, 0);
        if (since > 0 && System.currentTimeMillis() - since > MAX_HOLD_MS) {
            Log.i(TAG, "SOS silence expired after " + (MAX_HOLD_MS / 3600000) + "h — restoring ringer");
            exit(ctx);
            return false;
        }
        // Ringer modes order SILENT(0) < VIBRATE(1) < NORMAL(2), so ">" means
        // louder than we left it; going quieter still means hiding.
        //
        // The person switched the ringer back on themselves: whatever the SOS
        // state, they are not hiding. Without this the app kept muting its own
        // ping, call ringer and other members' sirens on a phone its owner had
        // deliberately made loud again (seen on the Redmi 2026-09-21: an SOS
        // left open, ringer turned back to normal, the next incoming SOS came in
        // silent). exit() leaves the ringer where they put it.
        int set = sp.getInt(KEY_SET_MODE, -1);
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (set != -1 && am != null && am.getRingerMode() > set) {
            Log.i(TAG, "SOS silence ended — ringer changed by user to " + am.getRingerMode());
            exit(ctx);
            return false;
        }
        return true;
    }

    /**
     * Silence the phone for a freshly sent SOS. Safe to call more than once:
     * a second SOS while one is open keeps the ringer mode saved by the first,
     * so exit() still returns the person's own setting.
     */
    static void enter(Context ctx) {
        if (ctx == null) return;
        Context app = ctx.getApplicationContext();
        SharedPreferences sp = prefs(app);
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);

        boolean already = sp.getBoolean(KEY_ACTIVE, false);
        SharedPreferences.Editor ed = sp.edit()
            .putBoolean(KEY_ACTIVE, true)
            .putLong(KEY_SINCE, System.currentTimeMillis());
        if (!already && am != null) ed.putInt(KEY_SAVED_MODE, am.getRingerMode());
        ed.apply();

        // Also stop anything of ours that is making noise right now.
        if (PingRingService.isRunning) PingRingService.stopService(app);
        if (CallRingingService.isRunning) CallRingingService.silence(app);

        if (am == null) return;
        int set = -1;
        try {
            am.setRingerMode(AudioManager.RINGER_MODE_SILENT);
            set = AudioManager.RINGER_MODE_SILENT;
        } catch (SecurityException noDndAccess) {
            try {
                am.setRingerMode(AudioManager.RINGER_MODE_VIBRATE);
                set = AudioManager.RINGER_MODE_VIBRATE;
            } catch (Exception e) {
                Log.w(TAG, "SOS silence: could not change ringer: " + e.getMessage());
            }
        } catch (Exception e) {
            Log.w(TAG, "SOS silence: could not change ringer: " + e.getMessage());
        }
        if (set != -1) sp.edit().putInt(KEY_SET_MODE, set).apply();
        Log.i(TAG, "SOS silence on (ringer " + am.getRingerMode()
            + ", saved " + sp.getInt(KEY_SAVED_MODE, -1) + ")");
    }

    /** The SOS is over: hand the person's ringer back. Safe when nothing was silenced. */
    static void exit(Context ctx) {
        if (ctx == null) return;
        Context app = ctx.getApplicationContext();
        SharedPreferences sp = prefs(app);
        if (!sp.getBoolean(KEY_ACTIVE, false)) return;

        int saved = sp.getInt(KEY_SAVED_MODE, -1);
        int set   = sp.getInt(KEY_SET_MODE, -1);
        sp.edit()
            .remove(KEY_ACTIVE).remove(KEY_SINCE)
            .remove(KEY_SAVED_MODE).remove(KEY_SET_MODE)
            .apply();

        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null || saved == -1) return;
        // Only undo our own change. If the person switched the ringer themselves
        // while the SOS was open, that choice is newer than ours and stands.
        if (set != -1 && am.getRingerMode() != set) {
            Log.i(TAG, "SOS silence off — ringer changed by user since, leaving it");
            return;
        }
        try {
            am.setRingerMode(saved);
            Log.i(TAG, "SOS silence off — ringer restored to " + saved);
        } catch (Exception e) {
            Log.w(TAG, "SOS silence: could not restore ringer: " + e.getMessage());
        }
    }
}
