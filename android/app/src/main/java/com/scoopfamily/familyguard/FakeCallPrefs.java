package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Fake-call settings: who "calls", whether a voice speaks when it is answered,
 * and whether the location notification carries a "Call me" button.
 *
 * Kept in native SharedPreferences, not localStorage, because the notification
 * button starts the call with the app closed and no WebView to ask. Nothing
 * here leaves the phone — a fake caller is nobody else's business.
 */
final class FakeCallPrefs {

    static final String PREF_NAME = "fake_call_prefs";

    private static final String KEY_NAME        = "caller_name";
    private static final String KEY_NUMBER      = "caller_number";
    private static final String KEY_VOICE       = "voice_on_answer";
    private static final String KEY_NOTIF_BTN   = "notification_button";

    /** Delay used by the notification button: long enough to pocket the phone. */
    static final int NOTIFICATION_DELAY_S = 5;
    /** Longest delay the timer accepts; anything longer belongs in an alarm app. */
    static final int MAX_DELAY_S = 600;

    private FakeCallPrefs() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    /** The name shown on the call screen; empty means the localized default ("Mom"). */
    static String name(Context ctx)   { return prefs(ctx).getString(KEY_NAME, ""); }
    static String number(Context ctx) { return prefs(ctx).getString(KEY_NUMBER, ""); }
    static boolean voice(Context ctx) { return prefs(ctx).getBoolean(KEY_VOICE, true); }

    /** Off until the user turns it on: the button is visible on the lock screen. */
    static boolean notificationButton(Context ctx) {
        return prefs(ctx).getBoolean(KEY_NOTIF_BTN, false);
    }

    static String displayName(Context ctx) {
        String n = name(ctx).trim();
        return n.isEmpty() ? ctx.getString(R.string.fake_call_default_name) : n;
    }

    static void save(Context ctx, String name, String number, boolean voice, boolean notificationButton) {
        prefs(ctx).edit()
            .putString(KEY_NAME, clip(name, 40))
            .putString(KEY_NUMBER, clip(number, 20))
            .putBoolean(KEY_VOICE, voice)
            .putBoolean(KEY_NOTIF_BTN, notificationButton)
            .apply();
    }

    static int clampDelay(int seconds) {
        return Math.max(0, Math.min(seconds, MAX_DELAY_S));
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        s = s.trim();
        return s.length() > max ? s.substring(0, max) : s;
    }
}
