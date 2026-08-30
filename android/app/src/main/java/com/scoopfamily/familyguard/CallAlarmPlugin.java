package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge so the React app can wake the screen and ring for an incoming call
 * that arrived over the Supabase Realtime websocket (app alive, JS cannot
 * turn the screen on itself). Mirrors SOSAlarmPlugin's trigger/stop/isPlaying
 * shape.
 */
@CapacitorPlugin(name = "CallAlarm")
public class CallAlarmPlugin extends Plugin {

    /**
     * Ring + wake the screen for an incoming call arriving over the websocket.
     * launch_activity is computed from MainActivity.isAppInForeground — same
     * authoritative flag the FCM path uses — rather than hardcoded false, so
     * the two independent delivery paths (this one fires whenever the JS is
     * alive enough to make a plugin call; FCM's onMessageReceived fires
     * whenever the app process is alive at all, foreground included) agree on
     * whether to show the native ringing Activity regardless of which one
     * wins the race. Only skip it when the app is genuinely foreground —
     * GlobalIncomingCall (the JS overlay) covers that case and launching both
     * produced two independent accept/decline surfaces stacked on screen.
     */
    @PluginMethod
    public void trigger(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(ctx, CallRingingService.class);
            i.putExtra("call_id",     call.getString("callId", ""));
            i.putExtra("caller_name", call.getString("callerName", getContext().getString(R.string.a_family_member)));
            i.putExtra("call_type",   call.getString("callType", "voice"));
            i.putExtra("caller_avatar", call.getString("callerAvatar", ""));
            i.putExtra("launch_activity", !MainActivity.isAppInForeground);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }

            JSObject ret = new JSObject();
            ret.put("triggered", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to trigger call alert: " + e.getMessage());
        }
    }

    /** Stop ringing (call was answered/declined/timed out elsewhere). */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            CallRingingService.stopService(getContext());
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop call alert: " + e.getMessage());
        }
    }

    /**
     * Whether "Display over other apps" is granted — required only for the
     * full-screen call alert while the phone is unlocked.
     */
    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", MainActivity.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    /** Opens the "Display over other apps" settings page on request. */
    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            MainActivity.openOverlaySettings(getContext());
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ringing", CallRingingService.isRunning);
        call.resolve(ret);
    }
}
