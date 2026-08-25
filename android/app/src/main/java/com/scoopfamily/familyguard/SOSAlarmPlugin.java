package com.scoopfamily.familyguard;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge so the React app can stop the native SOS siren.
 *
 * The siren is played by SOSSirenService (a foreground service) when a push
 * arrives while the app is closed or backgrounded. Tapping the notification
 * stops it via MainActivity, but if the user opens the app from the launcher
 * icon instead, JS needs a way to silence it via this plugin.
 */
@CapacitorPlugin(name = "SOSAlarm")
public class SOSAlarmPlugin extends Plugin {

    /** Stop the siren service (audio + vibration) and clear the SOS notification. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Context ctx = getContext();
            // stopService cuts audio immediately and sends a STOP action to the
            // service so it calls stopForeground + stopSelf → clears the notification.
            SOSSirenService.stopService(ctx);

            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop alarm: " + e.getMessage());
        }
    }

    /** Is the foreground siren service currently running? Used to show the stop button. */
    @PluginMethod
    public void isPlaying(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("playing", SOSSirenService.isRunning);
        call.resolve(ret);
    }
}
