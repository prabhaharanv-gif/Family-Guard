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
import android.util.Log;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * CallRingingActivity
 *
 * Full-screen incoming-call UI shown over the lock screen — same pattern as
 * SOSAlertActivity. Launched via setFullScreenIntent() from
 * CallRingingService. Accept/Decline both hand off to MainActivity via Intent
 * extras (call_id/call_action), which deep-links into the WebView's
 * /call/:callId route — the actual respond_to_call RPC runs there, same as
 * every other Supabase write in this app staying client-side JS.
 */
public class CallRingingActivity extends Activity {

    public static final String EXTRA_CALL_ID     = "call_id";
    public static final String EXTRA_CALLER_NAME = "caller_name";
    public static final String EXTRA_CALL_TYPE   = "call_type";
    public static final String EXTRA_CALLER_AVATAR = "caller_avatar";

    // Lets CallRingingService close this screen when the call stops ringing
    // (caller hung up, answered elsewhere, or the 35s timeout) — otherwise the
    // full-screen alert stayed on top after the call was already over.
    private static volatile CallRingingActivity visibleInstance = null;

    public static void finishIfShowing() {
        CallRingingActivity a = visibleInstance;
        if (a != null) {
            try { a.finish(); } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d("FamoraCall", "CallRingingActivity.onCreate");
        visibleInstance = this;

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

        final String callId = getIntent().getStringExtra(EXTRA_CALL_ID);
        String callerName   = getIntent().getStringExtra(EXTRA_CALLER_NAME);
        String callType     = getIntent().getStringExtra(EXTRA_CALL_TYPE);
        String avatarUrl    = getIntent().getStringExtra(EXTRA_CALLER_AVATAR);
        if (callerName == null || callerName.isEmpty()) callerName = getString(R.string.a_family_member);
        if (callType == null || callType.isEmpty()) callType = "voice";

        setContentView(buildLayout(callId, callerName, callType, avatarUrl));
    }

    @Override
    protected void onDestroy() {
        if (visibleInstance == this) visibleInstance = null;
        super.onDestroy();
    }

    /**
     * Volume keys silence the ringer without answering or rejecting — the
     * behaviour people expect from the system dialler. The call keeps ringing
     * for the caller; only local sound and vibration stop.
     */
    @Override
    public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            Log.d("FamoraCall", "volume key pressed — silencing ringer");
            CallRingingService.silence(this);
            return true; // consume so the volume UI does not appear
        }
        return super.onKeyDown(keyCode, event);
    }

    private View buildLayout(final String callId, String callerName, String callType, String avatarUrl) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#951345"));
        root.setPadding(dp(32), dp(48), dp(32), dp(48));

        // Avatar circle — the caller's profile photo when they have one,
        // otherwise their initial. Falls back to the call-type emoji only if
        // even the name is unknown.
        final android.widget.ImageView avatar = new android.widget.ImageView(this);
        int avatarSize = dp(112);
        LinearLayout.LayoutParams avatarLp =
            new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avatarLp.gravity = Gravity.CENTER_HORIZONTAL;
        avatarLp.bottomMargin = dp(8);
        avatar.setLayoutParams(avatarLp);
        avatar.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        avatar.setVisibility(View.GONE);
        root.addView(avatar);

        // Placeholder shown until (or unless) the photo loads.
        final TextView initial = new TextView(this);
        String letter = (callerName != null && !callerName.isEmpty())
            ? callerName.substring(0, 1).toUpperCase()
            : ("video".equals(callType) ? "📹" : "📞");
        initial.setText(letter);
        initial.setTextSize(48);
        initial.setTextColor(Color.WHITE);
        initial.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams initialLp =
            new LinearLayout.LayoutParams(avatarSize, avatarSize);
        initialLp.gravity = Gravity.CENTER_HORIZONTAL;
        initialLp.bottomMargin = dp(8);
        initial.setLayoutParams(initialLp);
        android.graphics.drawable.GradientDrawable circle =
            new android.graphics.drawable.GradientDrawable();
        circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#B01650"));
        initial.setBackground(circle);
        root.addView(initial);

        loadAvatarAsync(avatarUrl, avatar, initial, avatarSize);

        TextView title = new TextView(this);
        title.setText(callerName);
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(8));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText(getString("video".equals(callType)
            ? R.string.call_incoming_video
            : R.string.call_incoming_voice) + "…");
        sub.setTextColor(Color.parseColor("#FFD9E6"));
        sub.setTextSize(16);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, 0, 0, dp(48));
        root.addView(sub);

        LinearLayout buttonRow = new LinearLayout(this);
        buttonRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonRow.setLayoutParams(rowLp);

        Button declineBtn = new Button(this);
        declineBtn.setText(R.string.call_decline);
        declineBtn.setTextColor(Color.WHITE);
        declineBtn.setBackgroundColor(Color.parseColor("#4A0820"));
        declineBtn.setTextSize(16);
        declineBtn.setAllCaps(false);
        LinearLayout.LayoutParams declineLp = new LinearLayout.LayoutParams(
            0, dp(56), 1f);
        declineLp.rightMargin = dp(8);
        declineBtn.setLayoutParams(declineLp);
        declineBtn.setOnClickListener(v -> openApp(callId, "decline"));
        buttonRow.addView(declineBtn);

        Button acceptBtn = new Button(this);
        acceptBtn.setText(R.string.call_accept);
        acceptBtn.setTextColor(Color.parseColor("#951345"));
        acceptBtn.setBackgroundColor(Color.WHITE);
        acceptBtn.setTextSize(16);
        acceptBtn.setAllCaps(false);
        LinearLayout.LayoutParams acceptLp = new LinearLayout.LayoutParams(
            0, dp(56), 1f);
        acceptLp.leftMargin = dp(8);
        acceptBtn.setLayoutParams(acceptLp);
        acceptBtn.setOnClickListener(v -> openApp(callId, "accept"));
        buttonRow.addView(acceptBtn);

        root.addView(buttonRow);
        return root;
    }

    private void openApp(String callId, String action) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("call_id", callId);
        open.putExtra("call_action", action);
        open.putExtra("call_notification", true);
        startActivity(open);
        finish();
    }

    /**
     * Fetches the caller's profile photo off the main thread and swaps it in
     * for the initial once decoded, clipped to a circle. Any failure simply
     * leaves the initial showing — the ringing UI must never depend on the
     * network succeeding.
     */
    private void loadAvatarAsync(final String url, final android.widget.ImageView target,
                                 final TextView placeholder, final int sizePx) {
        if (url == null || url.isEmpty() || !url.startsWith("http")) return;

        new Thread(() -> {
            android.graphics.Bitmap bmp = null;
            try {
                java.net.HttpURLConnection c =
                    (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                c.setInstanceFollowRedirects(true);
                java.io.InputStream in = c.getInputStream();
                bmp = android.graphics.BitmapFactory.decodeStream(in);
                in.close();
                c.disconnect();
            } catch (Exception e) {
                Log.d("FamoraCall", "avatar load failed, keeping initial: " + e.getMessage());
            }
            if (bmp == null) return;

            // Centre-crop to a square FIRST. Scaling a non-square photo
            // straight to sizePx×sizePx stretched it and left it sitting badly
            // inside the circle; cropping keeps the face centred and fills the
            // circle edge to edge.
            int w = bmp.getWidth(), h = bmp.getHeight();
            final android.graphics.Bitmap square;
            if (w != h) {
                int side = Math.min(w, h);
                square = android.graphics.Bitmap.createBitmap(
                    bmp, (w - side) / 2, (h - side) / 2, side, side);
            } else {
                square = bmp;
            }

            final android.graphics.Bitmap scaled =
                android.graphics.Bitmap.createScaledBitmap(square, sizePx, sizePx, true);
            runOnUiThread(() -> {
                try {
                    androidx.core.graphics.drawable.RoundedBitmapDrawable d =
                        androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
                            .create(getResources(), scaled);
                    d.setCircular(true);
                    target.setImageDrawable(d);
                    target.setVisibility(View.VISIBLE);
                    placeholder.setVisibility(View.GONE);
                } catch (Exception ignored) {}
            });
        }, "call-avatar-load").start();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    // Unlike SOSAlertActivity, back is allowed here — declining a call the
    // user wants to ignore shouldn't require an explicit tap, and the ring
    // (native service) keeps going in the background either way until the
    // caller's own timeout marks it missed.
}
