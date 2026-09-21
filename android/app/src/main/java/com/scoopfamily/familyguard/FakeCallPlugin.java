package com.scoopfamily.familyguard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge for the Fake call section in Profile: the caller's name and number,
 * the voice and notification-button switches, and the "call me in…" timer.
 */
@CapacitorPlugin(name = "FakeCall")
public class FakeCallPlugin extends Plugin {

    @PluginMethod
    public void getSettings(PluginCall call) {
        JSObject r = new JSObject();
        r.put("name", FakeCallPrefs.name(getContext()));
        r.put("number", FakeCallPrefs.number(getContext()));
        r.put("voice", FakeCallPrefs.voice(getContext()));
        r.put("notificationButton", FakeCallPrefs.notificationButton(getContext()));
        call.resolve(r);
    }

    /** Saves all four settings, and redraws the location notification's button. */
    @PluginMethod
    public void setSettings(PluginCall call) {
        FakeCallPrefs.save(getContext(),
            call.getString("name", ""),
            call.getString("number", ""),
            call.getBoolean("voice", true),
            call.getBoolean("notificationButton", false));
        LocationForegroundService.refreshNotification(getContext());
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        Integer seconds = call.getInt("seconds");
        if (seconds == null) {
            call.reject("Missing required parameter: seconds");
            return;
        }
        try {
            FakeCallService.schedule(getContext(), seconds);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule the call: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            FakeCallService.stop(getContext());
        } catch (Exception e) {
            android.util.Log.w("FakeCall", "cancel failed: " + e.getMessage());
        }
        call.resolve();
    }

    /** { state: 'idle' | 'scheduled' | 'ringing', ringAt: epoch ms or 0 }. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", FakeCallService.state.name().toLowerCase(java.util.Locale.US));
        r.put("ringAt", FakeCallService.ringAt);
        call.resolve(r);
    }
}
