package com.scoopfamily.familyguard;

import android.content.pm.ActivityInfo;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * SOSAlertActivity
 *
 * A dedicated full-screen alert shown over the lock screen when an SOS arrives —
 * the same pattern WhatsApp/Truecaller use for incoming calls. This guarantees
 * a VISUAL alert even when the phone is locked and the app is killed, which a
 * plain notification cannot reliably do on aggressive Android skins.
 *
 * Launched via setFullScreenIntent() from SOSSirenService. Shows sender name,
 * the SOS message, and buttons to view location or dismiss the alarm.
 */
public class SOSAlertActivity extends Activity {

    /**
     * True while this screen is on display.
     *
     * SOSSirenService checks it shortly after trying to launch us, and posts a
     * heads-up notification only if we never appeared. Whether the launch
     * succeeds depends on SYSTEM_ALERT_WINDOW, the Android version and the OEM,
     * so it cannot be predicted — but it can be observed.
     */
    public static volatile boolean isShowing = false;

    public static final String EXTRA_SENDER  = "sos_sender";
    public static final String EXTRA_MESSAGE = "sos_message";
    public static final String EXTRA_LAT     = "sos_lat";
    public static final String EXTRA_LNG     = "sos_lng";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        isShowing = true;
        super.onCreate(savedInstanceState);
        // Portrait is already declared in the manifest for all three activities,
        // but a manifest value is a request the platform may override: OEM skins
        // and, from targetSdk 36, Android itself ignore it in a growing number of
        // situations. Asking again at runtime is the form that survives that, and
        // it costs nothing when the manifest was being honoured anyway.
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        // ── Show over lock screen + wake screen ──────────────────────────────
        // setShowWhenLocked is the whole mechanism: it makes this window OCCLUDE
        // the keyguard.
        //
        // Deliberately NOT requestDismissKeyguard() here. On a secure lock
        // screen that does not quietly unlock anything — it ASKS the user to,
        // and the unlock prompt is drawn on top of this Activity. The alert was
        // being created and resumed correctly and then covered by the bouncer,
        // so an emergency could not be read without unlocking first. The
        // keyguard is dismissed in leaveTo() instead, when the user has tapped
        // something that takes them elsewhere.
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

        // Keep the screen lit for as long as the alert is up. SOSSirenService's
        // screen wake lock runs out after 10 seconds — it is there to WAKE the
        // phone, not hold it awake — while the siren itself runs for 60, so the
        // display went dark on an emergency still sounding. The pre-27 branch
        // above has always set this; only the modern path was missing it. A
        // window flag rather than another wake lock: it lasts exactly as long as
        // this Activity is in front, with nothing to release by hand.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String sender  = getIntent().getStringExtra(EXTRA_SENDER);
        String message = getIntent().getStringExtra(EXTRA_MESSAGE);
        final String lat = getIntent().getStringExtra(EXTRA_LAT);
        final String lng = getIntent().getStringExtra(EXTRA_LNG);
        if (sender  == null || sender.isEmpty())  sender  = getString(R.string.a_family_member);
        if (message == null || message.isEmpty()) message = getString(R.string.sos_alert);

        setContentView(buildLayout(sender, message, lat, lng));
    }

    /**
     * singleTask means a second alert for the same emergency arrives here rather
     * than in onCreate. Without this the new intent was swallowed and the screen
     * kept the first alert's sender and message.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        setIntent(intent);

        String sender  = intent.getStringExtra(EXTRA_SENDER);
        String message = intent.getStringExtra(EXTRA_MESSAGE);
        String lat     = intent.getStringExtra(EXTRA_LAT);
        String lng     = intent.getStringExtra(EXTRA_LNG);
        if (sender  == null || sender.isEmpty())  sender  = getString(R.string.a_family_member);
        if (message == null || message.isEmpty()) message = getString(R.string.sos_alert);

        isShowing = true;
        setContentView(buildLayout(sender, message, lat, lng));
    }

    /**
     * Leave the alert for somewhere else — the app, or the map.
     *
     * This is the moment the keyguard genuinely has to go: the user has chosen
     * to act, and what comes next is a normal screen that cannot show over a
     * lock screen the way this one can. Asking here rather than in onCreate is
     * what keeps the unlock prompt off the alert itself.
     */
    private void leaveTo(Intent target) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                if (km != null) km.requestDismissKeyguard(this, null);
            } catch (Exception ignored) {}
        }
        try { startActivity(target); } catch (Exception ignored) {}
    }

    private View buildLayout(String sender, String message, final String lat, final String lng) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#951345"));
        root.setPadding(dp(32), dp(48), dp(32), dp(48));

        // 🆘 Big icon
        TextView icon = new TextView(this);
        icon.setText("🆘");
        icon.setTextSize(72);
        icon.setGravity(Gravity.CENTER);
        root.addView(icon);

        // Title
        TextView title = new TextView(this);
        title.setText(getString(R.string.sos_needs_help, sender));
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(8));
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        title.setLayoutParams(tlp);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        // Message
        TextView msg = new TextView(this);
        msg.setText(message);
        msg.setTextColor(Color.parseColor("#FFD9E6"));
        msg.setTextSize(18);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, 0, 0, dp(40));
        root.addView(msg);

        // View Location button (only if coords present)
        if (lat != null && !lat.isEmpty() && !"0".equals(lat) && lng != null && !lng.isEmpty()) {
            Button locBtn = new Button(this);
            locBtn.setText(R.string.sos_view_location);
            locBtn.setTextColor(Color.parseColor("#951345"));
            locBtn.setBackgroundColor(Color.WHITE);
            locBtn.setTextSize(16);
            locBtn.setAllCaps(false);
            LinearLayout.LayoutParams lbp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
            lbp.bottomMargin = dp(14);
            locBtn.setLayoutParams(lbp);
            locBtn.setOnClickListener(v -> {
                Intent map = new Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("https://www.google.com/maps?q=" + lat + "," + lng));
                map.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                leaveTo(map);
            });
            root.addView(locBtn);
        }

        // Open App button
        Button openBtn = new Button(this);
        openBtn.setText(R.string.sos_open_app);
        openBtn.setTextColor(Color.WHITE);
        openBtn.setBackgroundColor(Color.parseColor("#720D35"));
        openBtn.setTextSize(16);
        openBtn.setAllCaps(false);
        LinearLayout.LayoutParams obp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        obp.bottomMargin = dp(14);
        openBtn.setLayoutParams(obp);
        openBtn.setOnClickListener(v -> {
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("sos_notification", true);
            leaveTo(open);
            finish();
        });
        root.addView(openBtn);

        // Dismiss / Stop Alarm button
        Button stopBtn = new Button(this);
        stopBtn.setText(R.string.sos_stop_alarm);
        stopBtn.setTextColor(Color.WHITE);
        stopBtn.setBackgroundColor(Color.parseColor("#4A0820"));
        stopBtn.setTextSize(16);
        stopBtn.setAllCaps(false);
        LinearLayout.LayoutParams sbp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        stopBtn.setLayoutParams(sbp);
        stopBtn.setOnClickListener(v -> {
            // Stop the siren, then open the app rather than just closing. Ending
            // here dropped the user back to the launcher or a lock screen with
            // no idea what had happened beyond a name — the alert is the start
            // of dealing with an emergency, not the end of it.
            SOSSirenService.stopService(getApplicationContext());
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("sos_notification", true);
            leaveTo(open);
            finish();
        });
        root.addView(stopBtn);

        return root;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        // Prevent accidental dismiss — user must tap Stop Alarm
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        isShowing = false;
    }
}
