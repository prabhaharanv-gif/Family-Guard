package com.scoopfamily.familyguard;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The full-screen "Sending SOS in 5…" with a Cancel button.
 *
 * The countdown notification alone was not enough. With the app open, MIUI does
 * not pop a notification from the app in front — it goes quietly into the shade,
 * where nobody looks inside five seconds. A gesture that cannot be taken back is
 * worse than no gesture, so the countdown now takes the screen.
 *
 * Shown over the lock screen (showWhenLocked) the same way SOSAlertActivity is,
 * because the phone is usually pocketed when a shake fires. The notification is
 * still posted underneath, so the Cancel is reachable even if this screen is
 * refused by an OEM blocking background activity starts.
 */
public class SosCountdownActivity extends Activity {

    static final String EXTRA_ENDS_AT = "ends_at";   // SystemClock.elapsedRealtime

    private static volatile SosCountdownActivity visible;

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView counter;
    private long endsAt;

    /** Closes the screen when the send has gone out, or was cancelled elsewhere. */
    static void finishIfShowing() {
        SosCountdownActivity a = visible;
        if (a != null) a.runOnUiThread(a::finish);
    }

    /** The launch intent, shared with SosTileService's collapse-and-open call. */
    static Intent intent(android.content.Context ctx, long graceMs) {
        return new Intent(ctx, SosCountdownActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra(EXTRA_ENDS_AT, SystemClock.elapsedRealtime() + graceMs);
    }

    static void show(android.content.Context ctx, long graceMs) {
        try {
            ctx.startActivity(intent(ctx, graceMs));
        } catch (Exception e) {
            android.util.Log.w("SOS_Arming", "countdown screen refused: " + e.getMessage());
        }
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            long left = endsAt - SystemClock.elapsedRealtime();
            if (left <= 0) { finish(); return; }
            counter.setText(String.valueOf((int) Math.ceil(left / 1000.0)));
            main.postDelayed(this, 200);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        visible = this;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        endsAt = getIntent().getLongExtra(EXTRA_ENDS_AT, SystemClock.elapsedRealtime() + SosArming.GRACE_MS);
        setContentView(buildLayout());
        main.post(tick);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) endsAt = intent.getLongExtra(EXTRA_ENDS_AT, endsAt);
        visible = this;
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (visible == this) visible = null;
        super.onDestroy();
    }

    /** Back cancels: reaching for Back is what someone does when a screen appears by accident. */
    @Override
    public void onBackPressed() {
        cancel();
    }

    private void cancel() {
        sendBroadcast(new Intent(this, SosCancelReceiver.class)
            .setAction(SosCancelReceiver.ACTION_ABORT));
        finish();
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#951345"));
        root.setPadding(dp(28), dp(48), dp(28), dp(48));

        counter = new TextView(this);
        counter.setText("5");
        counter.setTextColor(Color.WHITE);
        counter.setTextSize(72);
        counter.setGravity(Gravity.CENTER);
        counter.setTypeface(counter.getTypeface(), Typeface.BOLD);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#B01650"));
        counter.setBackground(circle);
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(dp(140), dp(140));
        cl.gravity = Gravity.CENTER_HORIZONTAL;
        counter.setLayoutParams(cl);
        root.addView(counter);

        TextView title = new TextView(this);
        title.setText(R.string.sos_countdown_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(28), 0, dp(8));
        title.setTypeface(title.getTypeface(), Typeface.BOLD);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText(R.string.sos_countdown_hint);
        hint.setTextColor(Color.parseColor("#FFD9E6"));
        hint.setTextSize(16);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, 0, 0, dp(40));
        root.addView(hint);

        Button cancel = new Button(this);
        cancel.setText(R.string.sos_countdown_cancel);
        cancel.setTextColor(Color.parseColor("#951345"));
        cancel.setBackgroundColor(Color.WHITE);
        cancel.setTextSize(20);
        cancel.setAllCaps(false);
        cancel.setOnClickListener(v -> cancel());
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        cancel.setLayoutParams(bl);
        root.addView(cancel);

        return root;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
