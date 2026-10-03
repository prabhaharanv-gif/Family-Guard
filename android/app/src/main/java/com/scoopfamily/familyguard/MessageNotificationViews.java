package com.scoopfamily.familyguard;

import android.content.Context;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;

/**
 * Draws a message notification's text as a tinted bubble.
 *
 * With a Reply action, Android shows its own reply box right under the message,
 * in nearly the same pale colour as the standard notification card, so the two
 * ran together. The bubble gives the message its own background and a maroon
 * sender name. The system still draws the header (icon, app name, time) and the
 * actions around it, which is what DecoratedCustomViewStyle keeps.
 *
 * The plain title and text stay set on the builder too: the lock screen and
 * accessibility use those, not the bubble.
 */
final class MessageNotificationViews {

    private MessageNotificationViews() {}

    static void apply(Context ctx, NotificationCompat.Builder b, String title, String text) {
        b.setStyle(new NotificationCompat.DecoratedCustomViewStyle())
         .setCustomContentView(views(ctx, R.layout.notification_message_small, title, text))
         .setCustomBigContentView(views(ctx, R.layout.notification_message_big, title, text));
    }

    private static RemoteViews views(Context ctx, int layout, String title, String text) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
        rv.setTextViewText(R.id.msg_title, title);
        rv.setTextViewText(R.id.msg_body, text);
        return rv;
    }
}
