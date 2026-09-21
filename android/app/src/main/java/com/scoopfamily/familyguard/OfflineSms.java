package com.scoopfamily.familyguard;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.telephony.SmsManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Texts the family a member's last known position while the phone has no data.
 *
 * Everything else in this app reaches the family over the internet. Without it a
 * member simply goes quiet, and nobody can tell "out of coverage" from "in
 * trouble". SMS is the one channel that still works on a 2G-only road, with data
 * switched off, or on an empty data balance — and in a true dead zone the
 * carrier delivers the queued message as soon as there is a bar of signal.
 *
 * Off unless the member switches it on: this spends their money and rings other
 * people's phones. WHEN to send is OfflineSmsPlan's decision, tested separately;
 * this class owns the settings, the recipients and the sending.
 *
 * Recipients are the family admins (kept current by the app whenever it is
 * online) plus one number the member types in themselves.
 */
final class OfflineSms {

    private static final String TAG = "OfflineSms";

    // Stored alongside the location service's own settings, in the same file, so
    // sign-out clears everything about a member in one place.
    private static final String KEY_ENABLED   = "sms_enabled";
    private static final String KEY_EXTRA     = "sms_extra_number";
    private static final String KEY_ADMINS    = "sms_admin_numbers";   // newline separated
    private static final String KEY_NAME      = "sms_sender_name";
    private static final String KEY_OFFLINE   = "sms_offline_since";
    private static final String KEY_LAST_SENT = "sms_last_sent";
    private static final String KEY_COUNT     = "sms_sent_count";

    private OfflineSms() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext()
                  .getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ENABLED, false);
    }

    static String extraNumber(Context ctx) { return prefs(ctx).getString(KEY_EXTRA, ""); }

    static void saveSettings(Context ctx, boolean enabled, String extraNumber) {
        prefs(ctx).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_EXTRA, extraNumber == null ? "" : extraNumber.trim())
            .apply();
        Log.i(TAG, "settings saved — enabled=" + enabled);
    }

    /** Refreshed by the app while it has data, so the numbers are there when it does not. */
    static void saveContacts(Context ctx, List<String> adminNumbers, String senderName) {
        StringBuilder sb = new StringBuilder();
        if (adminNumbers != null) {
            for (String n : adminNumbers) {
                if (n == null || n.trim().isEmpty()) continue;
                if (sb.length() > 0) sb.append('\n');
                sb.append(n.trim());
            }
        }
        prefs(ctx).edit()
            .putString(KEY_ADMINS, sb.toString())
            .putString(KEY_NAME, senderName == null ? "" : senderName.trim())
            .apply();
    }

    /** Admins plus the member's own extra number, de-duplicated, in that order. */
    static List<String> recipients(Context ctx) {
        Set<String> out = new LinkedHashSet<>();
        String stored = prefs(ctx).getString(KEY_ADMINS, "");
        if (!stored.isEmpty()) {
            for (String n : stored.split("\n")) {
                if (!n.trim().isEmpty()) out.add(n.trim());
            }
        }
        String extra = extraNumber(ctx);
        if (!extra.isEmpty()) out.add(extra);
        return new ArrayList<>(out);
    }

    static boolean hasPermission(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }

    // ── Connectivity state ───────────────────────────────────────────────────

    /**
     * Called when the phone loses or regains data. Coming back online clears the
     * outage, so the cap and the interval start fresh next time.
     */
    static void setOnline(Context ctx, boolean online) {
        SharedPreferences p = prefs(ctx);
        if (online) {
            if (p.getLong(KEY_OFFLINE, 0) != 0) {
                Log.i(TAG, "back online — offline alerts reset");
            }
            p.edit().putLong(KEY_OFFLINE, 0).putLong(KEY_LAST_SENT, 0).putInt(KEY_COUNT, 0).apply();
        } else if (p.getLong(KEY_OFFLINE, 0) == 0) {
            p.edit().putLong(KEY_OFFLINE, System.currentTimeMillis()).apply();
            Log.i(TAG, "data lost — offline alerts armed, first SMS in "
                     + (OfflineSmsPlan.FIRST_DELAY_MS / 60000) + " min if it lasts");
        }
    }

    // ── Sending ──────────────────────────────────────────────────────────────

    /**
     * Evaluates the plan and sends if it is time. Cheap enough to call on every
     * location fix: almost always a few field reads and a comparison.
     */
    static void maybeSend(Context ctx, Location loc) {
        SharedPreferences p = prefs(ctx);
        long now = System.currentTimeMillis();

        OfflineSmsPlan.Action action = OfflineSmsPlan.decide(
            isEnabled(ctx), !recipients(ctx).isEmpty(),
            p.getLong(KEY_OFFLINE, 0), p.getLong(KEY_LAST_SENT, 0), p.getInt(KEY_COUNT, 0), now);

        if (action != OfflineSmsPlan.Action.SEND) return;

        if (!hasPermission(ctx)) {
            // Asked for at the switch; it can still be revoked later. Counted as
            // sent so a revoked permission does not retry every fix forever.
            Log.w(TAG, "SMS permission missing — cannot send the offline alert");
            p.edit().putLong(KEY_LAST_SENT, now).putInt(KEY_COUNT, p.getInt(KEY_COUNT, 0) + 1).apply();
            return;
        }

        String body = compose(ctx, loc, now);
        int sent = 0;
        for (String number : recipients(ctx)) {
            if (send(ctx, number, body)) sent++;
        }

        p.edit().putLong(KEY_LAST_SENT, now).putInt(KEY_COUNT, p.getInt(KEY_COUNT, 0) + 1).apply();
        Log.i(TAG, "offline alert sent to " + sent + " number(s), "
                 + (OfflineSmsPlan.MAX_MESSAGES - p.getInt(KEY_COUNT, 0)) + " left in this outage");
    }

    /**
     * Sends one message right now, ignoring the timing rules.
     *
     * The real alert only fires after 15 minutes offline, which is far too long
     * to wait when you are checking that a number is right. This lets someone
     * prove the whole chain — permission, numbers, SIM — in one tap, on a day
     * when nothing is wrong.
     *
     * @return how many numbers were texted; 0 means nothing was sent.
     */
    static int sendTestNow(Context ctx, Location loc) {
        if (!hasPermission(ctx)) {
            Log.w(TAG, "test SMS skipped — no SMS permission");
            return 0;
        }
        List<String> to = recipients(ctx);
        if (to.isEmpty()) {
            Log.w(TAG, "test SMS skipped — no recipients stored");
            return 0;
        }
        String body = ctx.getString(R.string.sms_test_prefix) + " "
                    + compose(ctx, loc, System.currentTimeMillis());
        int sent = 0;
        for (String number : to) if (send(ctx, number, body)) sent++;
        Log.i(TAG, "test SMS sent to " + sent + " of " + to.size() + " number(s)");
        return sent;
    }

    /**
     * One message, kept short: every 160 characters is another charge, and a
     * maps link is most of the budget already.
     */
    private static String compose(Context ctx, Location loc, long now) {
        String name = prefs(ctx).getString(KEY_NAME, "");
        if (name.isEmpty()) name = ctx.getString(R.string.a_family_member);

        String where = loc != null
            ? "https://maps.google.com/?q=" + String.format(Locale.US, "%.5f,%.5f",
                loc.getLatitude(), loc.getLongitude())
            : ctx.getString(R.string.sms_no_location);

        String at = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(now));
        return ctx.getString(R.string.sms_offline_body, name, at, where);
    }

    private static boolean send(Context ctx, String number, String body) {
        try {
            SmsManager sms = ctx.getSystemService(SmsManager.class);
            if (sms == null) sms = SmsManager.getDefault();
            // Indian scripts blow past 70 characters in one part, so this is
            // routinely multipart — divideMessage is what keeps it readable.
            ArrayList<String> parts = sms.divideMessage(body);
            if (parts.size() > 1) sms.sendMultipartTextMessage(number, null, parts, null, null);
            else sms.sendTextMessage(number, null, body, null, null);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "could not text " + mask(number) + ": " + e.getMessage());
            return false;
        }
    }

    /** Numbers are somebody's personal data; the log gets the last two digits. */
    private static String mask(String number) {
        if (number == null || number.length() < 2) return "***";
        return "***" + number.substring(number.length() - 2);
    }
}
