package com.scoopfamily.familyguard;

import java.util.ArrayList;
import java.util.List;

/**
 * The rules of the notification history, kept free of Android so they can be unit tested.
 * NotificationLog does the storing; this decides what is kept.
 *
 * Lists are newest first.
 */
final class NotificationLogRules {

    private NotificationLogRules() {}

    /** How long an entry stays: seven days, then it is dropped. */
    static final long KEEP_MS = 7L * 24 * 60 * 60 * 1000;

    /** A ceiling so a noisy family cannot grow the stored text without limit. */
    static final int MAX_ENTRIES = 200;

    /**
     * The same push can reach us twice (FCM, then the realtime copy) a moment apart. Two
     * entries with the same words inside this window are one notification.
     */
    static final long DUPLICATE_WINDOW_MS = 60_000L;

    static final class Entry {
        final long t;
        final String type;
        final String title;
        final String body;
        final String route;

        Entry(long t, String type, String title, String body, String route) {
            this.t = t;
            this.type = type == null ? "" : type;
            this.title = title == null ? "" : title;
            this.body = body == null ? "" : body;
            this.route = route == null ? "" : route;
        }
    }

    /** Drops what is older than a week, and anything past the ceiling. */
    static List<Entry> prune(List<Entry> newestFirst, long now) {
        List<Entry> out = new ArrayList<>();
        for (Entry e : newestFirst) {
            if (now - e.t > KEEP_MS) continue;
            out.add(e);
            if (out.size() >= MAX_ENTRIES) break;
        }
        return out;
    }

    static boolean isDuplicate(List<Entry> newestFirst, Entry candidate) {
        for (Entry e : newestFirst) {
            if (candidate.t - e.t > DUPLICATE_WINDOW_MS) break;
            if (e.type.equals(candidate.type)
                    && e.title.equals(candidate.title)
                    && e.body.equals(candidate.body)) {
                return true;
            }
        }
        return false;
    }

    /** The list with {@code entry} on the front, or unchanged when it is a duplicate. */
    static List<Entry> add(List<Entry> newestFirst, Entry entry, long now) {
        List<Entry> kept = prune(newestFirst, now);
        if (entry.title.isEmpty() || isDuplicate(kept, entry)) return kept;
        List<Entry> out = new ArrayList<>(kept.size() + 1);
        out.add(entry);
        out.addAll(kept);
        return prune(out, now);
    }

    /** How many entries arrived after the person last looked. */
    static int unread(List<Entry> newestFirst, long seenAt) {
        int n = 0;
        for (Entry e : newestFirst) {
            if (e.t > seenAt) n++;
        }
        return n;
    }
}
