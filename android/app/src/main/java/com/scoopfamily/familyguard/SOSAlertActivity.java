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
import android.graphics.drawable.GradientDrawable;
import android.widget.ImageView;
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

    /**
     * Whether this Activity appeared at all since the service last reset it.
     *
     * isShowing answers "is it up right now", which is the wrong question 1.2s
     * after launch: a recipient who dismisses the alert immediately would have
     * it recorded as never shown, and the OEM setup sheet would start nagging
     * about a permission that is working.
     */
    public static volatile boolean appearedSinceReset = false;

    public static final String EXTRA_SENDER  = "sos_sender";
    public static final String EXTRA_MESSAGE = "sos_message";
    public static final String EXTRA_LAT     = "sos_lat";
    public static final String EXTRA_LNG     = "sos_lng";
    /** Sender's phone number for the Call button; empty when the push has none. */
    public static final String EXTRA_PHONE   = "sos_phone";

    /**
     * The alert on screen right now, so it can be taken away when the sender
     * marks themselves safe. Without this the full-screen alert stayed up after
     * the emergency was resolved and each person had to dismiss it by hand.
     */
    private static volatile SOSAlertActivity visibleInstance = null;

    /** Closes the alert if it is showing. Safe to call from any thread. */
    public static void finishIfShowing() {
        SOSAlertActivity a = visibleInstance;
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        isShowing = true;
        appearedSinceReset = true;
        visibleInstance = this;
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

        readAlert(getIntent());
        render();
    }

    // The alert being shown. Kept in fields so Stop Alarm can redraw the same
    // screen as its second stage without going back to the intent.
    private String alertSender, alertMessage, alertLat, alertLng, alertPhone;
    private boolean alarmStopped = false;

    private void readAlert(Intent intent) {
        alertSender  = intent.getStringExtra(EXTRA_SENDER);
        alertMessage = intent.getStringExtra(EXTRA_MESSAGE);
        alertLat     = intent.getStringExtra(EXTRA_LAT);
        alertLng     = intent.getStringExtra(EXTRA_LNG);
        alertPhone   = intent.getStringExtra(EXTRA_PHONE);
        if (alertSender  == null || alertSender.isEmpty())  alertSender  = getString(R.string.a_family_member);
        if (alertMessage == null || alertMessage.isEmpty()) alertMessage = getString(R.string.sos_alert);
    }

    /**
     * Two stages. While the siren sounds, the only button is Stop Alarm: one
     * obvious thing to do, instead of a choice between four while the phone is
     * screaming. Once it is quiet, the screen offers what actually helps —
     * call them, get directions to them, or open the app.
     *
     * Starts straight at the second stage when there is no siren to stop: it
     * already timed out, or this phone's own SOS silence kept it quiet.
     */
    private void render() {
        boolean sirenLive = SOSSirenService.isRunning
            && !SosSilence.isActive(getApplicationContext());
        boolean actionStage = alarmStopped || !sirenLive;
        setContentView(buildLayout(actionStage));
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

        readAlert(intent);
        // A new push means the siren has (re)started, so back to stage one.
        alarmStopped = false;

        isShowing = true;
        appearedSinceReset = true;
        render();
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

    // The screen used to be solid alarm red from edge to edge, with a big 🆘
    // emoji and three near-identical red buttons. Recipients found it
    // frightening, and nothing on it said what to do first. Now it matches the
    // call screens: cream, with red kept for the one thing that has to stand
    // out (the alert badge and the main action), a plain line of guidance, and
    // buttons ranked by importance. The siren still does the alarming.
    private static final int CREAM      = Color.parseColor("#FFF8F0");
    private static final int INK        = Color.parseColor("#2A0A18");
    private static final int INK_SOFT   = Color.parseColor("#6B4A57");
    private static final int ALERT_RED  = Color.parseColor("#D32F2F");
    private static final int RED_TINT   = Color.parseColor("#FDECEC");
    private static final int RED_DEEP   = Color.parseColor("#B71C1C");
    private static final int MAROON     = Color.parseColor("#8B0D3D");
    private static final int BUTTON_FILL = Color.parseColor("#F6DCE6");

    private View buildLayout(boolean actionStage) {
        applyCreamSystemBars();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(CREAM);
        root.setPadding(dp(28), dp(40), dp(28), dp(40));

        root.addView(new View(this), new LinearLayout.LayoutParams(1, 0, 1f));

        // Alert badge: a red disc with a white warning line icon.
        android.widget.FrameLayout badge = new android.widget.FrameLayout(this);
        GradientDrawable disc = new GradientDrawable();
        disc.setShape(GradientDrawable.OVAL);
        disc.setColor(ALERT_RED);
        badge.setBackground(disc);
        ImageView badgeIcon = new ImageView(this);
        badgeIcon.setImageResource(R.drawable.ic_sos_alert);
        badge.addView(badgeIcon, new android.widget.FrameLayout.LayoutParams(
            dp(44), dp(44), Gravity.CENTER));
        root.addView(badge, new LinearLayout.LayoutParams(dp(92), dp(92)));

        // Title
        TextView title = new TextView(this);
        title.setText(getString(R.string.sos_needs_help, alertSender));
        title.setTextColor(INK);
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(22), 0, dp(12));
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        title.setLayoutParams(tlp);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        // Message (the SOS type) as a soft red chip rather than more big text.
        TextView msg = new TextView(this);
        msg.setText(alertMessage);
        msg.setTextColor(RED_DEEP);
        msg.setTextSize(15);
        msg.setTypeface(msg.getTypeface(), android.graphics.Typeface.BOLD);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(dp(16), dp(7), dp(16), dp(7));
        GradientDrawable chip = new GradientDrawable();
        chip.setColor(RED_TINT);
        chip.setCornerRadius(dp(18));
        msg.setBackground(chip);
        root.addView(msg, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // What to do next, in plain words.
        TextView hint = new TextView(this);
        hint.setText(R.string.sos_calm_hint);
        hint.setTextColor(INK_SOFT);
        hint.setTextSize(16);
        hint.setGravity(Gravity.CENTER);
        hint.setLineSpacing(dp(3), 1f);
        hint.setPadding(dp(8), dp(18), dp(8), 0);
        root.addView(hint, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        root.addView(new View(this), new LinearLayout.LayoutParams(1, 0, 1f));

        if (!actionStage) {
            // Stage one: the siren is sounding and this is the only button.
            View stopBtn = actionButton(getString(R.string.sos_stop_alarm),
                R.drawable.ic_sos_silence);
            stopBtn.setOnClickListener(v -> {
                SOSSirenService.stopService(getApplicationContext());
                alarmStopped = true;
                render();
            });
            root.addView(stopBtn);
            return root;
        }

        // Stage two: ways to reach them, most direct first.
        java.util.List<View> actions = new java.util.ArrayList<>();

        final String phone = alertPhone == null ? "" : alertPhone.trim();
        if (!phone.isEmpty()) {
            View callBtn = actionButton(getString(R.string.sos_call, alertSender),
                R.drawable.ic_fake_call_answer);
            callBtn.setOnClickListener(v -> {
                // ACTION_DIAL, not ACTION_CALL: needs no CALL_PHONE permission,
                // and the one confirming tap in the dialler guards against a
                // pocket-dial to someone who may be hiding.
                Intent dial = new Intent(Intent.ACTION_DIAL,
                    android.net.Uri.parse("tel:" + android.net.Uri.encode(phone)));
                dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                leaveTo(dial);
            });
            actions.add(callBtn);
        }

        final String lat = alertLat, lng = alertLng;
        boolean hasLocation = lat != null && !lat.isEmpty() && !"0".equals(lat)
            && lng != null && !lng.isEmpty();
        if (hasLocation) {
            View dirBtn = actionButton(getString(R.string.sos_directions),
                R.drawable.ic_sos_directions);
            dirBtn.setOnClickListener(v -> {
                Intent map = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(
                    "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng));
                map.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                leaveTo(map);
            });
            actions.add(dirBtn);
        }

        View openBtn = actionButton(getString(R.string.sos_open_app),
            R.drawable.ic_sos_family);
        openBtn.setOnClickListener(v -> {
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("sos_notification", true);
            leaveTo(open);
            finish();
        });
        actions.add(openBtn);

        for (int i = 0; i < actions.size(); i++) {
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) actions.get(i).getLayoutParams();
            if (i < actions.size() - 1) lp.bottomMargin = dp(12);
            root.addView(actions.get(i));
        }
        return root;
    }

    /**
     * Pill button with a line icon beside its label, both centred together.
     * A plain Button with a compound drawable pins the icon to the far edge on
     * a full-width button, so this is a clickable row instead.
     *
     * One style for every button: a light rose fill, deep enough to stand off
     * the cream, with a maroon outline and maroon label. A tint with no edge
     * did not read as a button; a different colour per button made the screen
     * look busy. The red badge stays the only strong colour on the screen.
     */
    private View actionButton(CharSequence text, int iconRes) {
        final int fill = BUTTON_FILL, fg = MAROON, strokeColor = MAROON;
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.HORIZONTAL);
        b.setGravity(Gravity.CENTER);
        b.setClickable(true);
        b.setFocusable(true);
        b.setPadding(dp(16), 0, dp(16), 0);
        b.setContentDescription(text);
        b.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(58)));

        GradientDrawable pill = new GradientDrawable();
        pill.setColor(fill);
        pill.setCornerRadius(dp(29));
        pill.setStroke(dp(2), strokeColor);
        // White ripple on dark fills, dark ripple on light ones.
        int ripple = fg == Color.WHITE ? Color.argb(60, 255, 255, 255) : Color.argb(40, 0, 0, 0);
        b.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(ripple), pill, null));

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setColorFilter(fg);
        LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(dp(20), dp(20));
        ilp.rightMargin = dp(10);
        b.addView(icon, ilp);

        TextView label = new TextView(this);
        label.setText(text);
        label.setTextColor(fg);
        label.setTextSize(16);
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        label.setMaxLines(2);
        label.setGravity(Gravity.CENTER);
        b.addView(label);
        return b;
    }

    /** Cream status and navigation bars with dark icons, so the screen reads as one surface. */
    private void applyCreamSystemBars() {
        android.view.Window w = getWindow();
        w.setStatusBarColor(CREAM);
        w.setNavigationBarColor(CREAM);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = w.getDecorView().getSystemUiVisibility()
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            w.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        // While the siren sounds, back does nothing — Stop Alarm is the way
        // out, so the alert cannot be swiped away unread. Once it is quiet,
        // back closes the screen like any other.
        if (alarmStopped || !SOSSirenService.isRunning) finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        isShowing = false;
        if (visibleInstance == this) visibleInstance = null;
    }
}
