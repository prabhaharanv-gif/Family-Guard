package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/** The notification history: what is kept, what is dropped, what counts as unread. */
public class NotificationLogRulesTest {

    private static final long NOW = 1_800_000_000_000L;
    private static final long DAY = 24L * 60 * 60 * 1000;

    private static NotificationLogRules.Entry e(long t, String title) {
        return new NotificationLogRules.Entry(t, "place", title, "", "/");
    }

    @Test
    public void newestEntryGoesFirst() {
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        list = NotificationLogRules.add(list, e(NOW - 1000, "older"), NOW);
        list = NotificationLogRules.add(list, e(NOW, "newer"), NOW);
        assertEquals("newer", list.get(0).title);
        assertEquals("older", list.get(1).title);
    }

    @Test
    public void entriesOlderThanSevenDaysAreDropped() {
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        list.add(e(NOW - 1000, "fresh"));
        list.add(e(NOW - 6 * DAY, "six days"));
        list.add(e(NOW - 8 * DAY, "eight days"));
        List<NotificationLogRules.Entry> kept = NotificationLogRules.prune(list, NOW);
        assertEquals(2, kept.size());
        assertEquals("six days", kept.get(1).title);
    }

    @Test
    public void sameNotificationTwiceInAMinuteIsOne() {
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        list = NotificationLogRules.add(list, e(NOW - 5000, "Asha reached Home"), NOW);
        list = NotificationLogRules.add(list, e(NOW, "Asha reached Home"), NOW);
        assertEquals(1, list.size());
    }

    @Test
    public void sameWordsLaterOnAreANewEntry() {
        // Asha reaches Home again the next evening: that is a second event, not a repeat.
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        list = NotificationLogRules.add(list, e(NOW - DAY, "Asha reached Home"), NOW);
        list = NotificationLogRules.add(list, e(NOW, "Asha reached Home"), NOW);
        assertEquals(2, list.size());
    }

    @Test
    public void emptyTitleIsNotLogged() {
        List<NotificationLogRules.Entry> list = NotificationLogRules.add(
            new ArrayList<>(), e(NOW, ""), NOW);
        assertTrue(list.isEmpty());
    }

    @Test
    public void listNeverGrowsPastTheCeiling() {
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        for (int i = 0; i < NotificationLogRules.MAX_ENTRIES + 25; i++) {
            list = NotificationLogRules.add(list, e(NOW - 10_000_000L + i * 100_000L, "n" + i), NOW);
        }
        assertEquals(NotificationLogRules.MAX_ENTRIES, list.size());
        // the newest survived, the oldest went
        assertEquals("n" + (NotificationLogRules.MAX_ENTRIES + 24), list.get(0).title);
    }

    @Test
    public void unreadCountsOnlyWhatCameAfterTheLastLook() {
        List<NotificationLogRules.Entry> list = new ArrayList<>();
        list.add(e(NOW, "c"));
        list.add(e(NOW - 2000, "b"));
        list.add(e(NOW - 9000, "a"));
        assertEquals(2, NotificationLogRules.unread(list, NOW - 5000));
        assertEquals(0, NotificationLogRules.unread(list, NOW));
        assertEquals(3, NotificationLogRules.unread(list, 0));
    }
}
