package com.scoopfamily.familyguard;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.RingtoneManager;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Per-alert ringtone selection.
 *
 * Four alerts can each have their own sound: message, SOS, voice call, video
 * call. Choices are stored as URI strings in the app's SharedPreferences, which
 * is what the services and MyFirebaseMessagingService already read, so a
 * selection survives the app being killed and is available to code running
 * without a WebView.
 *
 * The system picker is used rather than a bundled set of tones: it offers
 * whatever is already on the phone, is the interaction users expect from
 * "change ringtone", and adds nothing to the APK.
 *
 * An unset alert falls back to its built-in default, so this is purely additive
 * — a user who never opens the setting gets exactly the previous behaviour.
 */
@CapacitorPlugin(name = "Ringtone")
public class RingtonePlugin extends Plugin {

    public static final String KEY_MESSAGE = "tone_message";
    public static final String KEY_SOS     = "tone_sos";
    public static final String KEY_VOICE   = "tone_voice";
    public static final String KEY_VIDEO   = "tone_video";

    private static String keyFor(String type) {
        if (type == null) return null;
        switch (type) {
            case "message": return KEY_MESSAGE;
            case "sos":     return KEY_SOS;
            case "voice":   return KEY_VOICE;
            case "video":   return KEY_VIDEO;
            default:        return null;
        }
    }

    /** Ringtone type to show in the picker for each alert. */
    private static int pickerTypeFor(String type) {
        if ("sos".equals(type))     return RingtoneManager.TYPE_ALARM;
        if ("message".equals(type)) return RingtoneManager.TYPE_NOTIFICATION;
        return RingtoneManager.TYPE_RINGTONE;   // voice + video
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(
            MyFirebaseMessagingService.PREF_NAME, Context.MODE_PRIVATE);
    }

    /**
     * Resolve the chosen sound for one alert, or null when unset.
     * Services call this; a null means "use the built-in default".
     */
    public static Uri getUri(Context ctx, String key) {
        try {
            String s = ctx.getSharedPreferences(MyFirebaseMessagingService.PREF_NAME,
                Context.MODE_PRIVATE).getString(key, null);
            if (s == null || s.isEmpty()) return null;
            return Uri.parse(s);
        } catch (Exception e) { return null; }
    }

    /** Human-readable name for display, falling back to a label when unset. */
    private String titleFor(String key, String fallback) {
        Uri uri = getUri(getContext(), key);
        if (uri == null) return fallback;
        try {
            android.media.Ringtone r = RingtoneManager.getRingtone(getContext(), uri);
            String t = (r != null) ? r.getTitle(getContext()) : null;
            return (t == null || t.isEmpty()) ? fallback : t;
        } catch (Exception e) { return fallback; }
    }

    @PluginMethod
    public void getAll(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("message", titleFor(KEY_MESSAGE, "Default"));
        ret.put("sos",     titleFor(KEY_SOS,     "Default"));
        ret.put("voice",   titleFor(KEY_VOICE,   "Default"));
        ret.put("video",   titleFor(KEY_VIDEO,   "Default"));
        call.resolve(ret);
    }

    @PluginMethod
    public void pick(PluginCall call) {
        String type = call.getString("type");
        String key  = keyFor(type);
        if (key == null) { call.reject("Unknown alert type: " + type); return; }

        try {
            Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, pickerTypeFor(type));
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Select sound");
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, getUri(getContext(), key));
            // Held so the callback knows which alert this picker was opened for.
            call.setKeepAlive(true);
            getBridge().saveCall(call);
            startActivityForResult(call, i, "pickResult");
        } catch (Exception e) {
            call.reject("Could not open the sound picker: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            if (result.getResultCode() != Activity.RESULT_OK) {
                // Cancelled — leave the existing choice alone.
                JSObject ret = new JSObject();
                ret.put("changed", false);
                call.resolve(ret);
                return;
            }
            Intent data = result.getData();
            Uri picked = (data == null) ? null
                : data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);

            String key = keyFor(call.getString("type"));
            if (key == null) { call.reject("Unknown alert type"); return; }

            SharedPreferences.Editor ed = prefs().edit();
            if (picked == null) ed.remove(key);            // "Default" chosen
            else                ed.putString(key, picked.toString());
            ed.apply();

            // The message tone is a notification-channel property, and a
            // channel's sound cannot be changed after creation — the channel has
            // to be deleted and rebuilt for a new selection to take effect.
            if (KEY_MESSAGE.equals(key)) {
                MyFirebaseMessagingService.rebuildMessageChannel(getContext());
            }

            JSObject ret = new JSObject();
            ret.put("changed", true);
            ret.put("title", titleFor(key, "Default"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the selection: " + e.getMessage());
        }
    }

    @PluginMethod
    public void reset(PluginCall call) {
        String key = keyFor(call.getString("type"));
        if (key == null) { call.reject("Unknown alert type"); return; }
        prefs().edit().remove(key).apply();
        if (KEY_MESSAGE.equals(key)) {
            MyFirebaseMessagingService.rebuildMessageChannel(getContext());
        }
        call.resolve();
    }
}
