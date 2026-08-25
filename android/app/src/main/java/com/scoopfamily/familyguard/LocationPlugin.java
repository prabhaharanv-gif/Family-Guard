package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * LocationPlugin — Capacitor bridge between JS and LocationForegroundService.
 *
 * JS usage:
 *   import { registerPlugin } from '@capacitor/core'
 *   const LocationService = registerPlugin('LocationService')
 *
 *   // Start (call when user opens app / enables location sharing)
 *   await LocationService.start({
 *     supabaseUrl: 'https://xxx.supabase.co',
 *     supabaseKey: 'anon-key',
 *     userId:      'uuid',
 *     familyId:    'uuid',
 *     sessionToken: 'JWT-token',  // user's access token for RPC auth
 *   })
 *
 *   // Stop (call when user disables location sharing)
 *   await LocationService.stop()
 *
 *   // Check if running
 *   const { running } = await LocationService.isRunning()
 */
@CapacitorPlugin(name = "LocationService")
public class LocationPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String supabaseUrl   = call.getString("supabaseUrl");
        String supabaseKey   = call.getString("supabaseKey");
        String userId        = call.getString("userId");
        String familyId      = call.getString("familyId");
        String sessionToken  = call.getString("sessionToken", "");

        if (supabaseUrl == null || supabaseKey == null || userId == null || familyId == null) {
            call.reject("Missing required parameters: supabaseUrl, supabaseKey, userId, familyId");
            return;
        }

        // Store credentials so the service can read them even after the app is killed
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(
            LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(LocationForegroundService.KEY_URL,       supabaseUrl)
            .putString(LocationForegroundService.KEY_KEY,       supabaseKey)
            .putString(LocationForegroundService.KEY_USER_ID,   userId)
            .putString(LocationForegroundService.KEY_FAMILY_ID, familyId)
            .putString("session_token",                         sessionToken)
            .apply();

        LocationForegroundService.startService(ctx);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LocationForegroundService.stopService(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", LocationForegroundService.isRunning);
        call.resolve(result);
    }

    /**
     * Called when the user's session token refreshes — update it so the
     * running service always uses a valid JWT for Supabase RPC calls.
     */
    @PluginMethod
    public void updateSessionToken(PluginCall call) {
        String token = call.getString("sessionToken");
        if (token == null) { call.reject("sessionToken required"); return; }
        getContext().getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE)
            .edit().putString("session_token", token).apply();
        call.resolve();
    }
}
