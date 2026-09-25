package com.scoopfamily.familyguard;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * The phone tells this receiver about each wrong screen-lock attempt.
 *
 * Declared in the manifest with the "watch-login" policy and nothing else: no
 * lock, no wipe, no password rules. That is the only reason the app holds
 * device-admin status, and it is granted by the owner in a system dialog.
 */
public class AntiTheftAdminReceiver extends DeviceAdminReceiver {

    private static final String TAG = "AntiTheft";

    @Override
    public void onPasswordFailed(Context context, Intent intent) {
        AntiTheft.onPasswordFailed(context);
    }

    @Override
    public void onPasswordSucceeded(Context context, Intent intent) {
        AntiTheft.onPasswordSucceeded(context);
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        // The owner removed device-admin status in Android settings: the alert
        // cannot work any more, so do not leave it looking switched on.
        AntiTheft.setConfig(context, false, false);
        Log.i(TAG, "device admin removed — wrong-password alert switched off");
    }
}
