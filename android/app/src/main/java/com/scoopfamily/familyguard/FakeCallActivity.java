package com.scoopfamily.familyguard;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/**
 * The fake incoming-call screen, then the "call" itself once answered.
 *
 * Styled to match the real incoming-call screen (CallRingingActivity): cream
 * background, maroon avatar, the caller's name and number, round red and green
 * buttons. The layout is still a plain phone call's, so anyone glancing at the
 * phone should see an ordinary call. Shown over the lock screen without unlocking, the same way
 * CallRingingActivity is (setShowWhenLocked, no requestDismissKeyguard — that
 * would summon the unlock prompt over the call).
 *
 * Answering starts a running timer and, when enabled, a voice in the earpiece
 * reading a short script with pauses, so the call holds up if someone is close
 * enough to hear. The voice is the phone's own text-to-speech: no recordings to
 * ship per language, and nothing downloaded.
 */
public class FakeCallActivity extends Activity {

    private static final String TAG = "FakeCall";

    private static volatile FakeCallActivity visible;

    static boolean isShowing() { return visible != null; }

    /**
     * Closes the screen on the service's behalf — ring timeout, Cancel, or a new
     * schedule replacing this call. Must not stop the service in turn: during a
     * reschedule that is the very service asking.
     */
    static void finishIfShowing() {
        FakeCallActivity a = visible;
        if (a != null) a.runOnUiThread(a::close);
    }

    // Same values as CallRingingActivity, so both call screens match.
    private static final int CREAM    = Color.parseColor("#FFF8F0");
    private static final int INK      = Color.parseColor("#2A0A18");
    private static final int INK_SOFT = Color.parseColor("#6B4A57");
    private static final String DECLINE_RED  = "#D32F2F";
    private static final String ACCEPT_GREEN = "#1E8A4C";

    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean answered = false;
    private boolean ended = false;
    private long answeredAt;

    private TextView status;
    private LinearLayout buttons;
    private TextToSpeech tts;
    private PowerManager.WakeLock proximityLock;
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            long s = (SystemClock.elapsedRealtime() - answeredAt) / 1000;
            status.setText(String.format(Locale.US, "%02d:%02d", s / 60, s % 60));
            main.postDelayed(this, 1000);
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
        getWindow().setStatusBarColor(CREAM);
        getWindow().setNavigationBarColor(CREAM);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Dark status/nav icons, or they vanish on cream.
            int flags = getWindow().getDecorView().getSystemUiVisibility()
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }

        setContentView(buildLayout());
        FakeCallService.alertShown();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        // A fresh schedule while this screen is up: start over as a new call.
        if (answered || ended) {
            answered = false;
            ended = false;
            stopVoice();
            main.removeCallbacks(tick);
            setContentView(buildLayout());
        }
        visible = this;
        FakeCallService.alertShown();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        stopVoice();
        releaseProximity();
        if (visible == this) visible = null;
        super.onDestroy();
    }

    /** Volume keys silence the ringing, as on a real phone. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (!answered && (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
                || keyCode == KeyEvent.KEYCODE_VOLUME_UP)) {
            FakeCallService.silence();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        // Ringing: back declines. In a call: leave the call running, like a dialler.
        if (!answered) endCall();
        else moveTaskToBack(true);
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    private void answer() {
        if (answered || ended) return;
        answered = true;
        answeredAt = SystemClock.elapsedRealtime();
        FakeCallService.answered(this);

        buttons.removeAllViews();
        buttons.addView(roundButton(R.drawable.ic_fake_call_end, DECLINE_RED,
            getString(R.string.fake_call_end), v -> endCall()));
        main.post(tick);

        holdProximity();
        if (FakeCallPrefs.voice(this)) startVoice();
        Log.i(TAG, "answered");
    }

    /** The user ended or declined: close, and stop any ringing that is left. */
    private void endCall() {
        if (ended) return;
        Log.i(TAG, answered ? "call ended" : "declined");
        close();
        stopService(new android.content.Intent(this, FakeCallService.class));
    }

    private void close() {
        if (ended) return;
        ended = true;
        main.removeCallbacks(tick);
        stopVoice();
        releaseProximity();
        if (visible == this) visible = null;
        finish();
    }

    // ── Layout ───────────────────────────────────────────────────────────────

    private View buildLayout() {
        String name = FakeCallPrefs.displayName(this);
        String number = FakeCallPrefs.number(this).trim();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(CREAM);
        root.setPadding(dp(24), dp(72), dp(24), dp(56));
        root.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView initial = new TextView(this);
        initial.setText(name.substring(0, 1).toUpperCase(Locale.getDefault()));
        initial.setTextColor(Color.WHITE);
        initial.setTextSize(40);
        initial.setGravity(Gravity.CENTER);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#8B0D3D"));
        initial.setBackground(circle);
        root.addView(initial, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = new TextView(this);
        title.setText(name);
        title.setTextColor(INK);
        title.setTextSize(30);
        title.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(24), 0, dp(6));
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText(number.isEmpty() ? getString(R.string.fake_call_mobile) : number);
        sub.setTextColor(INK_SOFT);
        sub.setTextSize(16);
        sub.setGravity(Gravity.CENTER);
        root.addView(sub);

        status = new TextView(this);
        status.setText(R.string.fake_call_incoming);
        status.setTextColor(INK_SOFT);
        status.setTextSize(15);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(14), 0, 0);
        root.addView(status);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        buttons.addView(roundButton(R.drawable.ic_fake_call_end, DECLINE_RED,
            getString(R.string.fake_call_decline), v -> endCall()));
        View gap = new View(this);
        buttons.addView(gap, new LinearLayout.LayoutParams(dp(96), 1));
        buttons.addView(roundButton(R.drawable.ic_fake_call_answer, ACCEPT_GREEN,
            getString(R.string.fake_call_answer), v -> answer()));
        root.addView(buttons, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        return root;
    }

    private View roundButton(int icon, String color, String label, View.OnClickListener click) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        FrameLayout disc = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor(color));
        disc.setBackground(bg);
        disc.setClickable(true);
        disc.setOnClickListener(click);
        disc.setContentDescription(label);

        ImageView img = new ImageView(this);
        img.setImageResource(icon);
        FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER);
        disc.addView(img, ilp);
        col.addView(disc, new LinearLayout.LayoutParams(dp(72), dp(72)));

        TextView text = new TextView(this);
        text.setText(label);
        text.setTextColor(INK);
        text.setTextSize(14);
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, dp(10), 0, 0);
        col.addView(text);
        return col;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    // ── Voice ────────────────────────────────────────────────────────────────

    /**
     * Speaks the script into the earpiece, pausing between lines as if
     * listening to a reply. Falls back to English when the phone has no voice
     * for its own language; stays silent if there is no text-to-speech at all,
     * which still leaves a convincing call screen and timer.
     */
    private void startVoice() {
        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (am != null) {
            previousAudioMode = am.getMode();
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(false);
        }
        tts = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || ended || tts == null) return;
            String[] lines = scriptFor(Locale.getDefault());
            int lang = tts.setLanguage(Locale.getDefault());
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.ENGLISH);
                lines = scriptFor(Locale.ENGLISH);
            }
            Bundle params = new Bundle();
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_VOICE_CALL);
            tts.playSilentUtterance(1500, TextToSpeech.QUEUE_FLUSH, "lead");
            // Twice through, then the call just carries on quietly.
            for (int round = 0; round < 2; round++) {
                for (int i = 0; i < lines.length; i++) {
                    tts.speak(lines[i].trim(), TextToSpeech.QUEUE_ADD, params, "l" + round + i);
                    tts.playSilentUtterance(2800, TextToSpeech.QUEUE_ADD, "p" + round + i);
                }
            }
        });
    }

    private String[] scriptFor(Locale locale) {
        Configuration c = new Configuration(getResources().getConfiguration());
        c.setLocale(locale);
        Context localized = createConfigurationContext(c);
        return localized.getString(R.string.fake_call_voice_script).split("\\|");
    }

    private void stopVoice() {
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) am.setMode(previousAudioMode);
        }
    }

    /** Screen off against the ear, on again when taken away — as in a real call. */
    private void holdProximity() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                    "Famora::FakeCallProximity");
                proximityLock.acquire(60 * 60 * 1000L);
            }
        } catch (Exception e) {
            Log.w(TAG, "proximity lock failed: " + e.getMessage());
        }
    }

    private void releaseProximity() {
        try {
            if (proximityLock != null && proximityLock.isHeld()) proximityLock.release();
        } catch (Exception ignored) {}
        proximityLock = null;
    }
}
