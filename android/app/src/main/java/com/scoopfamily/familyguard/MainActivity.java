package com.scoopfamily.familyguard;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {

    // getUserMedia() (Agora calling) needs the WebView to actually grant
    // camera/mic — Capacitor's default WebChromeClient doesn't auto-grant
    // these, so onPermissionRequest below wires it to the real Android runtime
    // permission dialog.
    private static final int CALL_MEDIA_PERMISSION_REQUEST_CODE = 9401;
    private PermissionRequest pendingWebPermissionRequest = null;

    // FCM data messages reach onMessageReceived() whenever the app PROCESS is
    // alive — foreground included, not just backgrounded/killed as assumed
    // when CallAlarmPlugin's launch_activity=false suppression was added.
    // That meant an incoming call while foreground triggered BOTH the
    // websocket path (CallAlarmPlugin, correctly suppressing the native
    // ringing Activity) AND the FCM path (defaulting launch_activity=true) —
    // confirmed via device logs firing ~450ms apart, restarting the ringtone
    // mid-playback (killing the audio) and launching the native screen
    // anyway. MyFirebaseMessagingService checks this flag to skip its own
    // trigger entirely when the app is already visibly running.
    public static volatile boolean isAppInForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be called before super.onCreate() so the splash theme is
        // properly consumed — prevents Capacitor from rendering a second
        // floating launcher icon below the adaptive icon on app open.
        SplashScreen.installSplashScreen(this);

        registerPlugin(SOSAlarmPlugin.class);
        registerPlugin(MessagesPagePlugin.class);
        registerPlugin(LocationPlugin.class);
        registerPlugin(CallAlarmPlugin.class);
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(CrashReportingPlugin.class);
        registerPlugin(RingtonePlugin.class);

        showWhenLockedAndTurnScreenOn();

        super.onCreate(savedInstanceState);

        // Ensure all notification channels exist before first FCM message
        MyFirebaseMessagingService.ensureSosChannelStatic(getApplicationContext());
        MyFirebaseMessagingService.ensureMessageChannelStatic(getApplicationContext());
        MyFirebaseMessagingService.ensureSilentChannelStatic(getApplicationContext());
        MyFirebaseMessagingService.ensureCallChannelStatic(getApplicationContext());
        SOSSirenService.ensureSosPopupChannelStatic(getApplicationContext());
        CallRingingService.ensureCallRingChannelStatic(getApplicationContext());
        LocationForegroundService.ensureChannel(getApplicationContext());

        // USE_FULL_SCREEN_INTENT (Android 14+) is deliberately NOT requested
        // from here — see canDrawOverlays below for the same reasoning. It has
        // no requestPermissions() path, only a Settings page, and launching
        // that from onCreate pushed the app straight to the background on
        // every first launch after an install: on API 34+ devices the app
        // looked like it would not open at all, minimising itself the moment
        // it started (reported on a Motorola; never seen on the Android 12
        // test Xiaomi, where this branch cannot run). SosReliabilitySetup
        // already offers it as a user-initiated card, which is where it stays.
        setupWebViewMediaPermissions();
        clearWebViewCacheIfAppUpdated();

        handleSOSIntent(getIntent());
        handleCallIntent(getIntent());
    }

    /**
     * The WebView HTTP-caches index.html even though Capacitor serves it from
     * the APK's own assets. After an app update the APK ships a new index.html
     * pointing at a new hashed JS bundle, but the WebView keeps replaying the
     * cached old index.html — so the app runs the PREVIOUS build's JavaScript
     * against the new native code.
     *
     * Observed directly: APK asset index.html referenced index-CgjByS0Q.js
     * while the running app loaded index-EcmERTpc.js from a build two versions
     * earlier, silently reverting every JS-side fix in that update.
     *
     * Keyed on lastUpdateTime rather than versionCode so it also catches debug
     * reinstalls, which keep versionCode=1. Clearing happens after Capacitor's
     * load in super.onCreate(), so the stale page is already up — reload() to
     * pull the fresh index.html. Costs one extra load, only on the first launch
     * after an install.
     */
    private void clearWebViewCacheIfAppUpdated() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;

            long lastUpdate = getPackageManager()
                .getPackageInfo(getPackageName(), 0).lastUpdateTime;

            SharedPreferences prefs = getSharedPreferences(
                MyFirebaseMessagingService.PREF_NAME, MODE_PRIVATE);
            if (prefs.getLong("webview_cache_stamp", 0L) == lastUpdate) return;

            prefs.edit().putLong("webview_cache_stamp", lastUpdate).apply();

            final android.webkit.WebView webView = getBridge().getWebView();
            webView.post(() -> {
                webView.clearCache(true);
                webView.reload();
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /**
     * getUserMedia() calls from the Agora Web SDK (running inside the
     * Capacitor WebView) are gated by WebChromeClient.onPermissionRequest() —
     * without overriding it, the WebView silently denies camera/mic even when
     * the app process already holds the CAMERA/RECORD_AUDIO manifest
     * permissions. Subclassing BridgeWebChromeClient (rather than a plain
     * WebChromeClient) keeps Capacitor's own file-chooser/upload handling
     * intact — only onPermissionRequest is overridden.
     */
    private void setupWebViewMediaPermissions() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        // Chrome's autoplay policy blocks programmatic audio/video playback
        // without a *fresh* user gesture. Agora's remote audio/video track
        // .play() calls happen asynchronously after Accept (a token fetch +
        // channel join round-trip away from the actual tap), so by the time
        // they run, the WebView's autoplay guard silently blocks them —
        // symptom: call connects but there's no sound/video. This is a native
        // WebView, not a public web page, so it's safe to disable the
        // gesture requirement entirely.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    List<String> resources = Arrays.asList(request.getResources());
                    boolean needsCamera = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                    boolean needsMic    = resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);

                    List<String> toRequest = new ArrayList<>();
                    if (needsCamera && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            != PackageManager.PERMISSION_GRANTED) {
                        toRequest.add(Manifest.permission.CAMERA);
                    }
                    if (needsMic && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            != PackageManager.PERMISSION_GRANTED) {
                        toRequest.add(Manifest.permission.RECORD_AUDIO);
                    }

                    if (toRequest.isEmpty()) {
                        request.grant(request.getResources());
                    } else {
                        pendingWebPermissionRequest = request;
                        ActivityCompat.requestPermissions(MainActivity.this,
                            toRequest.toArray(new String[0]), CALL_MEDIA_PERMISSION_REQUEST_CODE);
                    }
                });
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CALL_MEDIA_PERMISSION_REQUEST_CODE || pendingWebPermissionRequest == null) return;

        boolean allGranted = grantResults.length > 0;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) { allGranted = false; break; }
        }

        if (allGranted) {
            pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        } else {
            pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = null;
    }

    /**
     * "Display over other apps" — needed only so an incoming call can take
     * over the screen while the phone is UNLOCKED. Without it the call still
     * rings and still shows full-screen on the lock screen; it just appears as
     * a heads-up banner when the phone is in use.
     *
     * Deliberately NOT auto-launched from onCreate. Doing so opened the
     * Settings screen the moment the app started on any device where the
     * permission was not already granted, which pushed the app to the
     * background and looked exactly like it minimising itself on launch
     * (reported on a Motorola; unnoticed on the test Xiaomi only because the
     * permission had already been granted there via adb). Losing the ability
     * to open the app at all is far worse than losing the unlocked
     * full-screen alert, so this is now user-initiated only.
     */
    public static boolean canDrawOverlays(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try { return android.provider.Settings.canDrawOverlays(ctx); }
        catch (Exception e) { return false; }
    }

    public static void openOverlaySettings(Context ctx) {
        try {
            Intent intent = new Intent(
                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSOSIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
    }

    /**
     * Cleared in onPause, NOT onStop. Turning the screen off while Famora is
     * the top activity fires onPause but frequently never fires onStop (more
     * so here, since this Activity sets showWhenLocked). Clearing it in
     * onStop therefore left the flag stuck at true with the screen off, and
     * CallRingingService read that as "app already foreground" and skipped
     * the full-screen incoming-call alert entirely — the exact case of
     * locking the phone and then receiving a call.
     */
    @Override
    public void onPause() {
        super.onPause();
        isAppInForeground = false;
    }

    @Override
    public void onStop() {
        super.onStop();
        isAppInForeground = false;
        setMessagesPageOpen(false);
    }

    public void setMessagesPageOpen(boolean open) {
        SharedPreferences prefs = getApplicationContext()
            .getSharedPreferences(MyFirebaseMessagingService.PREF_NAME, MODE_PRIVATE);
        prefs.edit().putBoolean(MyFirebaseMessagingService.KEY_MESSAGES_OPEN, open).apply();
    }

    private void showWhenLockedAndTurnScreenOn() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }
    }

    private void handleSOSIntent(Intent intent) {
        if (intent == null) return;

        if (intent.getBooleanExtra("sos_notification", false) || SOSSirenService.isRunning) {
            showWhenLockedAndTurnScreenOn();
        }

        if (SOSSirenService.isRunning || intent.getBooleanExtra("sos_notification", false)) {
            SOSSirenService.stopService(getApplicationContext());
        }

        // Route to /sos when tapped from notification (works from killed state too)
        String route = intent.getStringExtra("route");
        if ("/sos".equals(route) || intent.getBooleanExtra("sos_notification", false)) {
            if (getBridge() != null) {
                getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                        "window.__navigateTo && window.__navigateTo('/sos')", null
                    )
                );
            }
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

    /**
     * Handles a tap on the incoming-call full-screen Activity's Accept/Decline
     * buttons, or a tap on the call notification banner. Deep-links straight
     * into /call/:callId — CallPage.jsx itself performs the actual
     * respond_to_call RPC based on the current call status, same as every
     * other Supabase write in this app staying client-side JS (native code
     * never talks to Supabase directly).
     */
    private void handleCallIntent(Intent intent) {
        if (intent == null) return;

        boolean isCallNotification = intent.getBooleanExtra("call_notification", false);
        String callId     = intent.getStringExtra("call_id");
        String callAction = intent.getStringExtra("call_action"); // "accept" | "decline" | null

        // Tapping the system-displayed FCM notification (the app-closed path)
        // delivers the push data payload as extras — call_id and type — but
        // NOT call_notification, which only exists on PendingIntents this app
        // builds itself. Recognise both, otherwise that tap silenced the ring
        // without ever opening the call, leaving no way to answer.
        boolean isCallPush = "call".equals(intent.getStringExtra("type"))
            && callId != null && !callId.isEmpty();
        boolean opensCall = (isCallNotification || isCallPush)
            && callId != null && !callId.isEmpty();

        if (isCallNotification || isCallPush || callId != null
                || "call".equals(intent.getStringExtra("type"))) {
            Log.d("FamoraCall", "handleCallIntent: callNotifFlag=" + isCallNotification
                + " type=" + intent.getStringExtra("type")
                + " callId=" + callId
                + " action=" + callAction
                + " -> opensCall=" + opensCall);
        }

        if (opensCall) {
            showWhenLockedAndTurnScreenOn();
            // Only stop ringing when actually opening the call. Stopping it
            // just because the service was running meant merely unlocking or
            // reopening the app killed an in-progress ring.
            CallRingingService.stopService(getApplicationContext());
        }

        if (opensCall) {
            String path = "/call/" + callId;
            if (callAction != null && !callAction.isEmpty()) {
                path += "?action=" + callAction;
            }
            navigateWhenWebViewReady(path, 0);
        }
    }

    /**
     * Answering from a closed app is a COLD start: handleCallIntent runs in
     * onCreate, long before the WebView has loaded the bundle and App.jsx has
     * defined window.__navigateTo. A one-shot evaluateJavascript there is a
     * no-op against an unloaded page, so the call screen never opens. Retry
     * until the router exists (~10s), which is the same approach
     * navigateWhenReady() already uses on the JS side for push taps.
     */
    private void navigateWhenWebViewReady(final String path, final int attempt) {
        // ~15s of retries: a cold start has to load the bundle AND restore the
        // Supabase session before navigating is safe.
        if (attempt > 60) {
            Log.w("FamoraCall", "navigateWhenWebViewReady: gave up waiting for app readiness, path=" + path);
            return;
        }

        if (getBridge() == null || getBridge().getWebView() == null) {
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                () -> navigateWhenWebViewReady(path, attempt + 1), 250);
            return;
        }

        final android.webkit.WebView webView = getBridge().getWebView();
        // Waits for __authReady, not just __navigateTo: navigating before the
        // session is restored makes PrivateRoute replace the route with
        // /login, silently destroying the call screen.
        webView.post(() -> webView.evaluateJavascript(
            "(function(){ if (window.__navigateTo && window.__authReady) { window.__navigateTo('" + path + "'); return 'ok'; } return 'wait'; })()",
            value -> {
                if (value != null && value.contains("ok")) {
                    Log.d("FamoraCall", "navigateWhenWebViewReady: navigated to " + path + " after " + attempt + " retries");
                } else {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                        () -> navigateWhenWebViewReady(path, attempt + 1), 250);
                }
            }
        ));
    }
}
