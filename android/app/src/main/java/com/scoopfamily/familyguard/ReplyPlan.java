package com.scoopfamily.familyguard;

/**
 * The decisions behind replying to a message from its notification.
 *
 * Kept free of Android types and the network so they can be unit tested: the
 * reply is typed on a lock screen or home screen, sent with no app open, and
 * the only feedback is a notification, so every rule here has to be right the
 * first time.
 */
final class ReplyPlan {

    private ReplyPlan() {}

    /** The same ceiling send_message and send_direct_message enforce server-side. */
    static final int MAX_LENGTH = 4000;

    /** What happened to a reply, for the notification that follows it. */
    enum Outcome {
        /** The server accepted it. */
        SENT,
        /** Nothing was sent: no session, bad data, a rejection, or no network. */
        FAILED
    }

    /**
     * The text to send, or null when there is nothing worth sending.
     * Trimmed, and cut to the server's limit rather than refused: a long reply
     * typed in a hurry should arrive, not bounce.
     */
    static String clean(CharSequence raw) {
        if (raw == null) return null;
        String s = raw.toString().trim();
        if (s.isEmpty()) return null;
        return s.length() > MAX_LENGTH ? s.substring(0, MAX_LENGTH) : s;
    }

    /**
     * Whether the notification carries enough to address a reply. A group
     * message needs its family; a private one also needs the person to answer,
     * which is the sender of the message being replied to.
     */
    static boolean canReply(String familyId, boolean direct, String senderId) {
        if (familyId == null || familyId.trim().isEmpty()) return false;
        if (direct && (senderId == null || senderId.trim().isEmpty())) return false;
        return true;
    }

    /** The RPC that carries the reply. */
    static String rpcFor(boolean direct) {
        return direct ? "send_direct_message" : "send_message";
    }
}
