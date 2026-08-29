package com.scoopfamily.familyguard;

import android.content.Context;
import android.media.AudioManager;

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
