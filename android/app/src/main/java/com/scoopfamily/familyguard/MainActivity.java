package com.scoopfamily.familyguard;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SOSAlarmPlugin.class);
        registerPlugin(MessagesPagePlugin.class);
        registerPlugin(LocationPlugin.class);

        super.onCreate(savedInstanceState);

        // Ensure all notification channels exist before first FCM message
        MyFirebaseMessagingService.ensureSosChannelStatic(getApplicationContext());
        MyFirebaseMessagingService.ensureMessageChannelStatic(getApplicationContext());
        MyFirebaseMessagingService.ensureSilentChannelStatic(getApplicationContext());
        SOSSirenService.ensureSosPopupChannelStatic(getApplicationContext());
        LocationForegroundService.ensureChannel(getApplicationContext());

        handleSOSIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSOSIntent(intent);
    }

    @Override
    public void onStop() {
        super.onStop();
        setMessagesPageOpen(false);
    }

    public void setMessagesPageOpen(boolean open) {
        SharedPreferences prefs = getApplicationContext()
            .getSharedPreferences(MyFirebaseMessagingService.PREF_NAME, MODE_PRIVATE);
        prefs.edit().putBoolean(MyFirebaseMessagingService.KEY_MESSAGES_OPEN, open).apply();
    }

    private void handleSOSIntent(Intent intent) {
        if (intent == null) return;

        if (SOSSirenService.isRunning || intent.getBooleanExtra("sos_notification", false)) {
            SOSSirenService.stopService(getApplicationContext());
        }

        if (intent.getBooleanExtra("open_messages", false)) {
            if (getBridge() != null) {
                getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                        "window.__navigateTo && window.__navigateTo('/messages')", null
                    )
                );
            }
        }
    }
}
