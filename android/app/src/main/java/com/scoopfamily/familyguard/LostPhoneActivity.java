package com.scoopfamily.familyguard;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen "this phone is lost" message, shown over the lock screen so a
 * finder sees it the moment the screen lights up. Launched by LostPhone when
 * lost mode starts and again on every ring, in case it was closed.
 *
 * Reads the message from LostPhone's own preferences rather than the intent, so
 * a relaunch always shows the current text. Closing it is harmless: the ongoing
 * notification and the ring carry on until lost mode ends.
 */
public class LostPhoneActivity extends Activity {

    private static volatile LostPhoneActivity visibleInstance = null;

    /** Closes the screen if it is showing (lost mode ended). Safe from any thread. */
    static void finishIfShowing() {
        LostPhoneActivity a = visibleInstance;
        if (a != null) a.runOnUiThread(a::finish);
    }

    private static final int CREAM     = Color.parseColor("#FFF8F0");
    private static final int INK       = Color.parseColor("#2A0A18");
    private static final int INK_SOFT  = Color.parseColor("#6B4A57");
    private static final int ALERT_RED = Color.parseColor("#D32F2F");
    private static final int RED_TINT  = Color.parseColor("#FDECEC");
    private static final int RED_DEEP  = Color.parseColor("#B71C1C");
    private static final int MAROON    = Color.parseColor("#8B0D3D");
    private static final int BUTTON_FILL = Color.parseColor("#F6DCE6");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        visibleInstance = this;
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        // Occlude the keyguard without asking for an unlock (see SOSAlertActivity).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        render();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        render();
    }

    private void render() {
        if (!LostPhone.isActive(getApplicationContext())) { finish(); return; }
        setContentView(buildLayout());
    }

    private View buildLayout() {
        android.view.Window w = getWindow();
        w.setStatusBarColor(CREAM);
        w.setNavigationBarColor(CREAM);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = w.getDecorView().getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            w.getDecorView().setSystemUiVisibility(flags);
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(CREAM);
        root.setPadding(dp(28), dp(40), dp(28), dp(40));
        root.addView(new View(this), new LinearLayout.LayoutParams(1, 0, 1f));

        android.widget.FrameLayout badge = new android.widget.FrameLayout(this);
        GradientDrawable disc = new GradientDrawable();
        disc.setShape(GradientDrawable.OVAL);
        disc.setColor(ALERT_RED);
        badge.setBackground(disc);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_sos_alert);
        badge.addView(icon, new android.widget.FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER));
        root.addView(badge, new LinearLayout.LayoutParams(dp(92), dp(92)));

        TextView title = new TextView(this);
        title.setText(R.string.lost_title);
        title.setTextColor(INK);
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        title.setPadding(0, dp(22), 0, dp(14));
        root.addView(title, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        String body = LostPhone.bodyText(getApplicationContext());
        TextView msg = new TextView(this);
        msg.setText(body);
        msg.setTextColor(RED_DEEP);
        msg.setTextSize(19);
        msg.setTypeface(msg.getTypeface(), android.graphics.Typeface.BOLD);
        msg.setGravity(Gravity.CENTER);
        msg.setLineSpacing(dp(3), 1f);
        msg.setPadding(dp(20), dp(16), dp(20), dp(16));
        GradientDrawable box = new GradientDrawable();
        box.setColor(RED_TINT);
        box.setCornerRadius(dp(20));
        msg.setBackground(box);
        root.addView(msg, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        root.addView(new View(this), new LinearLayout.LayoutParams(1, 0, 1f));

        LinearLayout close = new LinearLayout(this);
        close.setGravity(Gravity.CENTER);
        close.setClickable(true);
        close.setFocusable(true);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(BUTTON_FILL);
        pill.setCornerRadius(dp(29));
        pill.setStroke(dp(2), MAROON);
        close.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(Color.argb(40, 0, 0, 0)), pill, null));
        TextView label = new TextView(this);
        label.setText(R.string.lost_close);
        label.setTextColor(MAROON);
        label.setTextSize(16);
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        close.addView(label);
        close.setOnClickListener(v -> finish());
        root.addView(close, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(58)));
        return root;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (visibleInstance == this) visibleInstance = null;
    }
}
