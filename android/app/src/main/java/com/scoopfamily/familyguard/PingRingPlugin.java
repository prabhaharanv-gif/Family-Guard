package com.scoopfamily.familyguard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge so the React app can silence a Find My Phone ring.
 *
 * Why this exists
 * ---------------
 * PingRingService could only ever be stopped from the Stop action on its own
 * notification. That is one route, and it fails in the situation the feature is
 * for: the phone has been found, its owner is holding it, and the fastest thing
 * they do is open the app — where there was no way to make the noise stop.
 * They had to find and expand the notification instead, while it rang.
 *
 * PingRingService.stopService() already existed for exactly this and nothing
 * called it. This exposes it, and mirrors SOSAlarmPlugin's stop/isPlaying
 * shape so the in-app banner for a ping works the same way as the one for the
 * siren.
 */
@CapacitorPlugin(name = "PingRing")
public class PingRingPlugin extends Plugin {

    /** Silence the ring. Safe to call when nothing is ringing. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            PingRingService.stopService(getContext());
        } catch (Exception e) {
            // Never reject: the caller is a user trying to stop a noise, and an
            // error dialog is not a useful answer to that.
            android.util.Log.w("PingRing", "stop failed: " + e.getMessage());
        }
        call.resolve();
    }

    /**
     * Whether the ring is sounding right now.
     *
     * Lets the app show its silence control when it is opened mid-ring, and
     * take it away again when the ring stops on its own — the service gives up
     * after 30 seconds whether or not anyone silenced it.
     */
    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ringing", PingRingService.isRunning);
        call.resolve(result);
    }
}
