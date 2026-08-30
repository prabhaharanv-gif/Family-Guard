package com.scoopfamily.familyguard;

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

    public static final String EXTRA_SENDER  = "sos_sender";
    public static final String EXTRA_MESSAGE = "sos_message";
    public static final String EXTRA_LAT     = "sos_lat";
    public static final String EXTRA_LNG     = "sos_lng";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Show over lock screen + wake screen ──────────────────────────────
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

        String sender  = getIntent().getStringExtra(EXTRA_SENDER);
        String message = getIntent().getStringExtra(EXTRA_MESSAGE);
        final String lat = getIntent().getStringExtra(EXTRA_LAT);
        final String lng = getIntent().getStringExtra(EXTRA_LNG);
        if (sender  == null || sender.isEmpty())  sender  = "A family member";
        if (message == null || message.isEmpty()) message = "SOS Alert";

        setContentView(buildLayout(sender, message, lat, lng));
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
        title.setText(sender + " needs help!");
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
            locBtn.setText("📍 View Location");
            locBtn.setTextColor(Color.parseColor("#951345"));
            locBtn.setBackgroundColor(Color.WHITE);
            locBtn.setTextSize(16);
            locBtn.setAllCaps(false);
            LinearLayout.LayoutParams lbp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
            lbp.bottomMargin = dp(14);
            locBtn.setLayoutParams(lbp);
            locBtn.setOnClickListener(v -> {
                try {
                    Intent map = new Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://www.google.com/maps?q=" + lat + "," + lng));
                    map.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(map);
                } catch (Exception ignored) {}
            });
            root.addView(locBtn);
        }

        // Open App button
        Button openBtn = new Button(this);
        openBtn.setText("Open FamilyGuard");
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
            startActivity(open);
            finish();
        });
        root.addView(openBtn);

        // Dismiss / Stop Alarm button
        Button stopBtn = new Button(this);
        stopBtn.setText("✋ I Understand — Stop Alarm");
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
            startActivity(open);
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
}
