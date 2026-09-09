package com.scoopfamily.familyguard;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Controls call audio routing. The Agora Web SDK running inside the WebView
 * has no way to touch Android's AudioManager, and Chromium's WebRTC stack
 * defaults call audio to the loudspeaker + a generic media-volume path
 * instead of the earpiece + voice-call path a real phone call uses — that's
 * why voice calls opened on speaker and both voice/video calls sounded quiet
 * (MODE_IN_COMMUNICATION is what engages the device's proper echo
 * cancellation/gain routing for call audio; without it Chromium falls back
 * to a plain media playback path).
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    /** Call once when a call becomes active. speakerOn=false routes to the earpiece. */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            boolean speakerOn = call.getBoolean("speakerOn", false);
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(speakerOn);
                // Voice-call stream can be left low from a previous ringtone/media
                // session — bring it to a sensible audible level, same reasoning
                // as SOSSirenService maxing the alarm stream.
                int max = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL);
                int target = Math.max(am.getStreamVolume(AudioManager.STREAM_VOICE_CALL), (int) (max * 0.8));
                am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, Math.min(target, max), 0);
            }
            call.resolve(new JSObject().put("started", true));
        } catch (Exception e) {
            call.reject("Failed to start call audio routing: " + e.getMessage());
        }
    }

    /** Toggle speaker mid-call. */
    @PluginMethod
    public void setSpeakerOn(PluginCall call) {
        try {
            boolean speakerOn = call.getBoolean("speakerOn", false);
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) am.setSpeakerphoneOn(speakerOn);
            call.resolve(new JSObject().put("speakerOn", speakerOn));
        } catch (Exception e) {
            call.reject("Failed to set speaker: " + e.getMessage());
        }
    }

    // ── Outgoing ringback ────────────────────────────────────────────────
    // The tone the CALLER hears while the callee's phone is ringing. There was
    // nothing playing on that side at all, so an outgoing call was silent until
    // it connected and gave no sign it was doing anything.
    //
    // Deliberately separate from start()/setSpeakerOn()/stop() above, which own
    // the in-call routing: this runs BEFORE a call is answered and changes no
    // audio mode and no speakerphone state. It only starts and stops a tone.

    private static final int RINGBACK_VOLUME = 80;   // ToneGenerator scale, 0-100

    // One at a time, held statically for the same reason RingtonePlugin holds
    // its preview that way: stop has to reach the tone a different plugin
    // invocation started.
    private static ToneGenerator ringbackTone = null;

    /**
     * Start the standard ringback pattern. TONE_SUP_RINGTONE repeats until it
     * is stopped, so there is nothing to re-trigger while the callee's phone
     * rings.
     *
     * @param speaker play on the media path, whose loudspeaker a video caller
     *                holding the phone away from their ear can hear. A voice
     *                caller has it at their ear, so that one goes to the
     *                voice-call path, as on a dialler.
     */
    @PluginMethod
    public void startRingback(PluginCall call) {
        boolean speaker = call.getBoolean("speaker", false);
        stopRingbackTone();
        try {
            ringbackTone = new ToneGenerator(
                speaker ? AudioManager.STREAM_MUSIC : AudioManager.STREAM_VOICE_CALL,
                RINGBACK_VOLUME);
            ringbackTone.startTone(ToneGenerator.TONE_SUP_RINGTONE);
            call.resolve(new JSObject().put("started", true));
        } catch (Exception e) {
            // Some devices refuse to hand out a ToneGenerator when another
            // audio session holds the stream. A silent outgoing call is the
            // behaviour we already had, and is not worth failing the call for.
            stopRingbackTone();
            call.resolve(new JSObject().put("started", false));
        }
    }

    /** Stop it — the call was answered, declined, or nobody picked up. */
    @PluginMethod
    public void stopRingback(PluginCall call) {
        stopRingbackTone();
        call.resolve(new JSObject().put("stopped", true));
    }

    private static synchronized void stopRingbackTone() {
        try {
            if (ringbackTone != null) {
                ringbackTone.stopTone();
                ringbackTone.release();
            }
        } catch (Exception ignored) {}
        ringbackTone = null;
    }

    // The WebView going away mid-call must not leave a tone playing with
    // nothing left to stop it.
    @Override
    protected void handleOnDestroy() {
        stopRingbackTone();
        super.handleOnDestroy();
    }

    /** Call when the call ends — restore normal audio routing. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
            call.resolve(new JSObject().put("stopped", true));
        } catch (Exception e) {
            call.reject("Failed to stop call audio routing: " + e.getMessage());
        }
    }
}
