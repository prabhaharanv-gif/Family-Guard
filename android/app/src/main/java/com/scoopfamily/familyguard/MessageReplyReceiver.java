package com.scoopfamily.familyguard;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;

/**
 * Reply to a message straight from its notification, without opening the app.
 *
 * The message notification carries a Reply action with a text box. What is
 * typed arrives here, is sent through MessageReplySender, and the notification
 * is then rewritten to say whether it went. Android shows a spinner on the
 * notification after a reply until the app updates it, so this ALWAYS updates
 * it, success or not.
 *
 * exported="false" in the manifest: only the PendingIntent built here can fire
 * it, and that intent names this class and this package explicitly.
 */
public class MessageReplyReceiver extends BroadcastReceiver {

    private static final String TAG = "MsgReply";

    static final String ACTION_REPLY      = "com.scoopfamily.familyguard.REPLY_MESSAGE";
    static final String KEY_TEXT          = "reply_text";
    static final String EXTRA_FAMILY_ID   = "family_id";
    static final String EXTRA_DIRECT      = "direct";
    static final String EXTRA_SENDER_ID   = "sender_id";
    static final String EXTRA_SENDER_NAME = "sender_name";
    static final String EXTRA_NOTIF_ID    = "notif_id";
    static final String EXTRA_CHANNEL_ID  = "channel_id";

    /** How long the "sent" confirmation stays before it removes itself. */
    private static final long CONFIRM_MS = 5000L;

    /**
     * The Reply action for a message notification, or null when the push does
     * not carry enough to address a reply (an older server that sends no
     * sender id for a private message).
     */
    static NotificationCompat.Action buildAction(Context ctx, int notifId, String channelId,
                                                 String familyId, boolean direct,
                                                 String senderId, String senderName) {
        if (!ReplyPlan.canReply(familyId, direct, senderId)) return null;

        Intent i = new Intent(ctx, MessageReplyReceiver.class);
        i.setAction(ACTION_REPLY);
        i.setPackage(ctx.getPackageName());
        i.putExtra(EXTRA_FAMILY_ID, familyId);
        i.putExtra(EXTRA_DIRECT, direct);
        i.putExtra(EXTRA_SENDER_ID, senderId);
        i.putExtra(EXTRA_SENDER_NAME, senderName);
        i.putExtra(EXTRA_NOTIF_ID, notifId);
        i.putExtra(EXTRA_CHANNEL_ID, channelId);

        // RemoteInput writes the typed text into this intent, so the
        // PendingIntent has to be mutable on Android 12+. It names its target
        // explicitly, so nothing else can fill it in or receive it.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, notifId, i, flags);

        RemoteInput input = new RemoteInput.Builder(KEY_TEXT)
            .setLabel(ctx.getString(R.string.reply_hint))
            .build();

        return new NotificationCompat.Action.Builder(R.drawable.ic_stat_notify,
                ctx.getString(R.string.reply_action), pi)
            .addRemoteInput(input)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAllowGeneratedReplies(true)
            .build();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_REPLY.equals(intent.getAction())) return;
        final Context ctx = context.getApplicationContext();

        final String familyId   = intent.getStringExtra(EXTRA_FAMILY_ID);
        final boolean direct    = intent.getBooleanExtra(EXTRA_DIRECT, false);
        final String senderId   = intent.getStringExtra(EXTRA_SENDER_ID);
        final String senderName = intent.getStringExtra(EXTRA_SENDER_NAME);
        final int notifId       = intent.getIntExtra(EXTRA_NOTIF_ID, 0);
        final String channelId  = intent.getStringExtra(EXTRA_CHANNEL_ID);

        Bundle results = RemoteInput.getResultsFromIntent(intent);
        final String text = ReplyPlan.clean(results != null ? results.getCharSequence(KEY_TEXT) : null);

        if (text == null || !ReplyPlan.canReply(familyId, direct, senderId)) {
            // Nothing to send, but the spinner must still stop.
            show(ctx, notifId, channelId, senderName, ctx.getString(R.string.reply_empty), null, true);
            return;
        }

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ReplyPlan.Outcome out = MessageReplySender.send(ctx, familyId, direct, senderId, text);
                if (out == ReplyPlan.Outcome.SENT) {
                    Log.i(TAG, "Reply sent from the notification");
                    show(ctx, notifId, channelId, senderName,
                        ctx.getString(R.string.reply_sent, text), null, true);
                } else {
                    Log.w(TAG, "Reply could not be sent");
                    // Keep a Reply action so the member can try again from here.
                    show(ctx, notifId, channelId, senderName, ctx.getString(R.string.reply_failed),
                        buildAction(ctx, notifId, channelId, familyId, direct, senderId, senderName), false);
                }
            } finally {
                pending.finish();
            }
        }, "msg-reply").start();
    }

    /** Rewrites the notification with the outcome. Quiet: it must not ring again. */
    private static void show(Context ctx, int notifId, String channelId, String senderName,
                             String text, NotificationCompat.Action retry, boolean fades) {
        try {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || channelId == null) return;

            Intent open = new Intent(ctx, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("open_messages", true);
            PendingIntent pi = PendingIntent.getActivity(ctx, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channelId)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(android.graphics.Color.parseColor("#951345"))
                .setContentTitle("💬 " + (senderName != null ? senderName : "Family"))
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(pi);
            MessageNotificationViews.apply(ctx, b,
                "💬 " + (senderName != null ? senderName : "Family"), text);
            if (retry != null) b.addAction(retry);
            if (fades) b.setTimeoutAfter(CONFIRM_MS);

            nm.notify(notifId, b.build());
        } catch (Exception e) {
            Log.w(TAG, "Could not update the notification: " + e.getMessage());
        }
    }
}
