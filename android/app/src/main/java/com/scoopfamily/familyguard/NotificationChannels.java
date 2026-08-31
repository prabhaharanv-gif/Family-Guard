package com.scoopfamily.familyguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * Keeps notification channel labels in the device's language.
 *
 * Every ensure*Channel() in this app returns early when the channel already
 * exists — correctly, because a channel's sound and importance are frozen at
 * creation and re-creating one under the same id silently restores the old
 * settings. But that early return also means a channel keeps whatever NAME it
 * was born with, forever: on an existing install the labels would stay English
 * no matter what res/values-ta says, and they would not follow the user
 * switching their phone to Tamil either.
 *
 * Name and description are the only two properties Android does let an app
 * change after creation. Re-submitting a channel with just those updated is
 * therefore safe — the sound, importance and vibration pattern each channel was
 * created with are left exactly as they are, which matters here because the SOS
 * channel is deliberately silent (SOSSirenService plays the real siren) and the
 * call channel is deliberately audible.
 *
 * Call this from the early-return branch, so labels re-localise on the next
 * launch after a language change.
 */
final class NotificationChannels {

    private NotificationChannels() {}

    /**
     * Refresh an existing channel's visible text. No-op if the channel has not
     * been created yet — the caller's normal creation path handles that.
     */
    static void refreshText(Context ctx, NotificationManager nm,
                            String channelId, int nameRes, int descRes) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm == null) return;

        NotificationChannel existing = nm.getNotificationChannel(channelId);
        if (existing == null) return;

        String name = ctx.getString(nameRes);
        String desc = ctx.getString(descRes);

        // Skip the round-trip when nothing changed, so this stays cheap on the
        // hot paths that call ensure* on every push.
        CharSequence currentName = existing.getName();
        if (name.contentEquals(currentName == null ? "" : currentName)
                && name.length() > 0
                && desc.equals(existing.getDescription())) {
            return;
        }

        existing.setName(name);
        existing.setDescription(desc);
        nm.createNotificationChannel(existing);
    }
}
