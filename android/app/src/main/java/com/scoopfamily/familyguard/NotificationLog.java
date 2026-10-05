package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The notification history: the last seven days of what Kinest told this phone, kept so
 * that swiping a notification away does not lose it. Shown under the bell on the Family tab.
 *
 * Stored on this phone only (SharedPreferences). The text is saved as it was shown, in the
 * language the phone was using at the time, so it needs no translating later.
 *
 * Chat messages are deliberately not logged here: the Messages tab already is their history.
 */
final class NotificationLog {

    private static final String KEY_ITEMS   = "notif_log_v1";
    private static final String KEY_SEEN_AT = "notif_log_seen_at";

    private static final Object LOCK = new Object();

    private NotificationLog() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext()
            .getSharedPreferences(MyFirebaseMessagingService.PREF_NAME, Context.MODE_PRIVATE);
    }

    /** Records one notification. Never throws: a logging fault must not lose the notification itself. */
    static void add(Context ctx, String type, String title, String body, String route) {
        try {
            long now = System.currentTimeMillis();
            synchronized (LOCK) {
                List<NotificationLogRules.Entry> list = load(ctx);
                List<NotificationLogRules.Entry> next = NotificationLogRules.add(
                    list, new NotificationLogRules.Entry(now, type, title, body, route), now);
                save(ctx, next);
            }
        } catch (Exception e) {
            Log.w("FamoraCall", "could not log the notification: " + e.getMessage());
        }
    }

    static List<NotificationLogRules.Entry> all(Context ctx) {
        synchronized (LOCK) {
            return NotificationLogRules.prune(load(ctx), System.currentTimeMillis());
        }
    }

    static long seenAt(Context ctx) {
        return prefs(ctx).getLong(KEY_SEEN_AT, 0L);
    }

    static int unread(Context ctx) {
        return NotificationLogRules.unread(all(ctx), seenAt(ctx));
    }

    static void markAllSeen(Context ctx) {
        prefs(ctx).edit().putLong(KEY_SEEN_AT, System.currentTimeMillis()).apply();
    }

    static void clear(Context ctx) {
        synchronized (LOCK) {
            prefs(ctx).edit().remove(KEY_ITEMS).apply();
        }
        markAllSeen(ctx);
    }

    private static List<NotificationLogRules.Entry> load(Context ctx) {
        List<NotificationLogRules.Entry> out = new ArrayList<>();
        String raw = prefs(ctx).getString(KEY_ITEMS, null);
        if (raw == null || raw.isEmpty()) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(new NotificationLogRules.Entry(
                    o.optLong("t", 0L), o.optString("type"), o.optString("title"),
                    o.optString("body"), o.optString("route")));
            }
        } catch (Exception e) {
            // A damaged store is dropped rather than crashing every push.
            Log.w("FamoraCall", "notification log unreadable, starting over: " + e.getMessage());
            out.clear();
        }
        return out;
    }

    private static void save(Context ctx, List<NotificationLogRules.Entry> list) throws Exception {
        JSONArray arr = new JSONArray();
        for (NotificationLogRules.Entry e : list) {
            JSONObject o = new JSONObject();
            o.put("t", e.t);
            o.put("type", e.type);
            o.put("title", e.title);
            o.put("body", e.body);
            o.put("route", e.route);
            arr.put(o);
        }
        prefs(ctx).edit().putString(KEY_ITEMS, arr.toString()).apply();
    }
}
