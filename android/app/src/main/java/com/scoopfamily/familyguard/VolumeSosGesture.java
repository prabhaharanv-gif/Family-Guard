package com.scoopfamily.familyguard;

import android.content.Context;
import android.database.ContentObserver;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.VolumeProvider;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

/**
 * Raises an SOS on two volume presses one way followed by two the other —
 * up, up, down, down (or down, down, up, up), with the app closed.
 *
 * How the presses are received, and why it is done this way
 * ---------------------------------------------------------
 * The first version of this watched the volume *value* through a
 * ContentObserver and inferred a press from the change. That was wrong, and
 * measurably so on the Redmi (Android 12, MIUI):
 *
 *   · With the screen off it saw nothing at all. MIUI consumes volume keys
 *     while locked — the system log shows policyFlags dropping the
 *     FLAG_PASS_TO_USER bit (0x2000000 asleep vs 0x22000000 awake) — and the
 *     volume never moves, so there is no change to observe. A perfect
 *     up-up-down-down at 07:17 was completely invisible. That is the pocket
 *     case, which is the entire reason the gesture exists.
 *   · At either end of the scale it went blind again. Once the volume is at 0,
 *     pressing Down changes nothing; at maximum, Up changes nothing. Five real
 *     presses produced three detections for exactly this reason.
 *
 * A press is not a volume change, so this now asks for the presses themselves.
 * A MediaSession holding a remote VolumeProvider receives volume key events
 * directly — the same mechanism that lets you change music volume with the
 * phone locked — which is immune to both problems above: it fires on the key,
 * not on the value, so neither the keyguard nor the ends of the scale matter.
 *
 * The cost, and how it is paid
 * ----------------------------
 * While this session owns the volume keys the system stops applying them
 * itself, so the phone's volume would freeze. Every press is therefore mirrored
 * straight back onto STREAM_MUSIC with the normal UI, and the provider's own
 * level is reset to the middle each time so it can never pin at a rail and stop
 * reporting. The user's volume keys keep behaving exactly as before.
 *
 * The ContentObserver is kept as a fallback rather than deleted: when another
 * app is actually playing audio its session outranks this one and takes the
 * keys, and in that case the volume really does move, so watching the value is
 * the right answer there. Presses arriving through both paths are collapsed by
 * the suppression window below.
 */
final class VolumeSosGesture {

    private static final String TAG = "SOS_VolumeGesture";

    /**
     * How long after mirroring a press to ignore the observer.
     *
     * Mirroring moves the real volume, which wakes the ContentObserver a few
     * milliseconds later. Without this the same physical press would be counted
     * once from the key and once from the value it caused.
     */
    private static final long OBSERVER_SUPPRESS_MS = 500;

    /** Arbitrary scale for the remote provider; only the direction is used. */
    private static final int PROVIDER_MAX = 100;
    private static final int PROVIDER_MID = 50;

    /** The streams a volume key can land on when the fallback path is in play. */
    private static final int[] WATCHED_STREAMS = {
        AudioManager.STREAM_MUSIC,
        AudioManager.STREAM_RING,
        AudioManager.STREAM_NOTIFICATION,
        AudioManager.STREAM_ALARM,
    };

    private final Context      ctx;
    private final AudioManager audio;
    private final int[]        lastVolume = new int[WATCHED_STREAMS.length];

    private ContentObserver observer;
    private MediaSession    session;
    private VolumeProvider  provider;
    private AudioTrack      silence;

    private long suppressObserverUntil = 0;

    /**
     * The shape of the gesture, and the only place it is decided. Plain Java,
     * no Android types, unit tested in VolumeGesturePatternTest.
     */
    private final VolumeGesturePattern pattern = new VolumeGesturePattern();

    VolumeSosGesture(Context ctx) {
        this.ctx   = ctx.getApplicationContext();
        this.audio = (AudioManager) this.ctx.getSystemService(Context.AUDIO_SERVICE);
        snapshotVolumes();
    }

    /**
     * Starts listening. Registered by LocationForegroundService, which is the
     * only thing guaranteed to be alive while the app is closed — so, like every
     * native gesture here, this stops working if location sharing is off.
     */
    void start() {
        if (audio == null) {
            Log.w(TAG, "No AudioManager — volume gesture unavailable");
            return;
        }
        startMediaSession();
        startSilence();
        startObserver();
    }

    void stop() {
        if (observer != null) {
            try {
                ctx.getContentResolver().unregisterContentObserver(observer);
            } catch (Exception e) {
                Log.w(TAG, "Could not unregister the volume observer: " + e.getMessage());
            }
            observer = null;
        }
        if (silence != null) {
            try {
                silence.stop();
                silence.release();
            } catch (Exception e) {
                Log.w(TAG, "Could not release the silent track: " + e.getMessage());
            }
            silence = null;
        }
        if (session != null) {
            try {
                session.setActive(false);
                session.release();
            } catch (Exception e) {
                Log.w(TAG, "Could not release the media session: " + e.getMessage());
            }
            session = null;
            provider = null;
        }
    }

    // ── Primary path: the key events themselves ──────────────────────────────

    private void startMediaSession() {
        try {
            session = new MediaSession(ctx, "FamilyGuardSosVolume");

            provider = new VolumeProvider(
                    VolumeProvider.VOLUME_CONTROL_RELATIVE, PROVIDER_MAX, PROVIDER_MID) {
                @Override
                public void onAdjustVolume(int direction) {
                    if (direction == 0) return;
                    // Hand the press straight back to the phone so volume still
                    // works, then reset our own level: left alone it would walk
                    // to an end of the scale and stop reporting, which is the
                    // exact failure this replaced.
                    mirrorToStream(direction);
                    setCurrentVolume(PROVIDER_MID);
                    onPress(direction > 0 ? 1 : -1);
                }
            };
            session.setPlaybackToRemote(provider);

            // A session only receives volume keys while it is active and looks
            // like it is playing. Nothing is actually played — this exists only
            // to be handed the key events.
            session.setPlaybackState(new PlaybackState.Builder()
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                .setActions(PlaybackState.ACTION_PLAY_PAUSE)
                .build());
            session.setCallback(new MediaSession.Callback() {});
            session.setActive(true);

            Log.i(TAG, "Volume SOS gesture armed via MediaSession — two up then two down, or the reverse");
        } catch (Exception e) {
            Log.w(TAG, "Could not start the media session, falling back to volume watching: "
                     + e.getMessage());
            session  = null;
            provider = null;
        }
    }

    /**
     * Plays inaudible silence on a loop, for as long as the gesture is armed.
     *
     * Registering as the media button session is not enough on this device: with
     * the screen off MIUI withheld the volume keys anyway, and the app saw
     * nothing. The theory this tests is that the system only routes volume keys
     * to a session that is actually producing audio, which is why a music app
     * keeps volume control with the phone locked and we did not.
     *
     * Deliberately does NOT request audio focus. Taking focus would pause
     * whatever the user is listening to, every time the service starts, which is
     * a far worse bargain than the gesture is worth. Focus is advisory, so
     * playback works without it.
     *
     * Silence is generated here rather than shipped as a res/raw file on
     * purpose: adding a file to res/raw shifts the generated R.raw ids, and that
     * has silently broken this app's alarm audio before.
     *
     * USAGE_MEDIA keeps it clear of the siren, which plays on USAGE_ALARM.
     */
    private void startSilence() {
        try {
            final int rate = 8000;
            final int frames = rate;   // one second, looped forever
            int bytes = frames * 2;    // 16-bit mono

            silence = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setBufferSizeInBytes(bytes)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build();

            silence.write(new short[frames], 0, frames);
            silence.setLoopPoints(0, frames, -1);
            silence.setVolume(0f);
            silence.play();
            Log.i(TAG, "Silent keepalive started — testing whether it unlocks screen-off volume keys");
        } catch (Exception e) {
            Log.w(TAG, "Could not start the silent keepalive: " + e.getMessage());
            silence = null;
        }
    }

    private void mirrorToStream(int direction) {
        try {
            audio.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                direction > 0 ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER,
                AudioManager.FLAG_SHOW_UI);
            suppressObserverUntil = System.currentTimeMillis() + OBSERVER_SUPPRESS_MS;
        } catch (Exception e) {
            Log.w(TAG, "Could not mirror the volume change: " + e.getMessage());
        }
    }

    // ── Fallback path: the value, for when another app owns the keys ─────────

    private void startObserver() {
        try {
            observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
                @Override
                public void onChange(boolean selfChange) {
                    onSettingsChanged();
                }
            };
            // Any System setting, not a named volume key: MIUI stores stream
            // volumes under its own key names, so matching on a specific URI is
            // a portability trap. The handler only acts when a stream we watch
            // has actually moved, which makes the extra wake-ups free.
            ctx.getContentResolver().registerContentObserver(
                Settings.System.CONTENT_URI, true, observer);
        } catch (Exception e) {
            Log.w(TAG, "Could not register the volume observer: " + e.getMessage());
        }
    }

    /** Records where every watched stream currently sits, without counting it. */
    private void snapshotVolumes() {
        if (audio == null) return;
        for (int i = 0; i < WATCHED_STREAMS.length; i++) {
            try {
                lastVolume[i] = audio.getStreamVolume(WATCHED_STREAMS[i]);
            } catch (Exception ignored) {
                lastVolume[i] = -1;
            }
        }
    }

    /**
     * Works out whether a watched stream moved and, if so, which way. Only the
     * first moved stream is counted: one key press can ripple into more than one
     * stream (ring and notification are tied together on most devices), and
     * counting both would turn a single press into two.
     */
    private void onSettingsChanged() {
        if (audio == null) return;

        // Our own mirrored write, coming back around. Re-read so the next real
        // change is measured from here, but do not count it as a press.
        if (System.currentTimeMillis() < suppressObserverUntil) {
            snapshotVolumes();
            return;
        }

        int direction = 0;
        for (int i = 0; i < WATCHED_STREAMS.length; i++) {
            int now;
            try {
                now = audio.getStreamVolume(WATCHED_STREAMS[i]);
            } catch (Exception e) {
                continue;
            }
            int was = lastVolume[i];
            lastVolume[i] = now;
            if (was < 0 || now == was) continue;
            if (direction == 0) direction = now > was ? 1 : -1;
        }
        if (direction != 0) onPress(direction);
    }

    // ── Pattern recognition, shared by both paths ────────────────────────────

    /**
     * Both the key path and the value path funnel through here. The shape of the
     * gesture lives in VolumeGesturePattern, which is plain Java and unit
     * tested; this method adds only the two things that need Android — the
     * post-send cooldown, and the log.
     */
    private void onPress(int direction) {
        long now = System.currentTimeMillis();

        if (SosArming.inCooldown(now)) {
            Log.d(TAG, VolumeGesturePattern.dirName(direction) + " ignored — cooldown, "
                     + (SosArming.cooldownRemaining(now) / 1000) + "s left");
            pattern.reset();
            return;
        }

        VolumeGesturePattern.Result result = pattern.press(direction, now);
        Log.d(TAG, result.detail);
        if (result.isArmed()) SosArming.arm(ctx, result.source);
    }
}
