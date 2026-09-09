package com.scoopfamily.familyguard;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ResolveInfo;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import android.database.Cursor;
import android.media.Ringtone;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
@CapacitorPlugin(
    name = "Ringtone",
    permissions = {
        // A song chosen in the music app comes back as a MediaStore uri, and
        // the one-shot grant on that result dies with the picking activity —
        // long before the alert it was chosen for ever sounds. Holding the
        // media permission is what keeps it readable. Split in two because the
        // permission was renamed in Android 13; the legacy one is capped at 32
        // in the manifest, so only one of these is ever requestable.
        @Permission(alias = RingtonePlugin.PERM_AUDIO,        strings = { "android.permission.READ_MEDIA_AUDIO" }),
        @Permission(alias = RingtonePlugin.PERM_AUDIO_LEGACY, strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    }
)
public class RingtonePlugin extends Plugin {

    public static final String PERM_AUDIO        = "audio";
    public static final String PERM_AUDIO_LEGACY = "audioLegacy";

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

            // Go straight to the sound picker.
            //
            // Left implicit, this phone shows MIUI's chooser first — measured
            // at +951ms and +557ms on two consecutive taps, against 3ms for
            // everything the app itself does between the tap and the intent.
            // The chooser is there because MIUI registers four handlers for
            // this action: the sound picker, the sound recorder, Theme Manager
            // and File Explorer. Only the first is what "change alert sound"
            // means, so it is addressed directly and the other three (and the
            // screen asking about them) never appear.
            //
            // Falls back to the implicit intent, chooser and all, whenever the
            // sound picker cannot be found — a different OEM, or a phone where
            // it is disabled. Requires the <queries> declaration in
            // AndroidManifest.xml to see the handlers at all.
            try {
                java.util.List<android.content.pm.ResolveInfo> matches =
                    getContext().getPackageManager().queryIntentActivities(i, 0);
                android.content.pm.ActivityInfo chosen = null;
                if (matches != null) {
                    for (android.content.pm.ResolveInfo ri : matches) {
                        if (ri == null || ri.activityInfo == null) continue;
                        String pkg = ri.activityInfo.packageName;
                        if (pkg != null && pkg.contains("soundpicker")) {
                            chosen = ri.activityInfo;
                            break;
                        }
                    }
                    // No recognisable sound picker, but only one handler at all:
                    // that one is unambiguous, so there is nothing to choose.
                    if (chosen == null && matches.size() == 1) {
                        chosen = matches.get(0).activityInfo;
                    }
                }
                if (chosen != null && chosen.packageName != null && chosen.name != null) {
                    i.setClassName(chosen.packageName, chosen.name);
                }
            } catch (Exception e) {
                // Any doubt and the implicit intent still works, chooser and all.
            }

            // Held so the callback knows which alert this picker was opened for.
            call.setKeepAlive(true);
            getBridge().saveCall(call);
            startActivityForResult(call, i, "pickResult");

            // Fade the picker in rather than sliding it up from the bottom.
            // The slide is Android's default for an opening activity and is
            // what makes the picker feel like it is "travelling" onto the
            // screen; a cross-fade reads as instant even though the elapsed
            // time is identical. overridePendingTransition applies to the
            // transition just started, so it has to follow the start call, and
            // it has to run on the UI thread.
            final Activity host = getActivity();
            if (host != null) {
                host.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try {
                            host.overridePendingTransition(
                                android.R.anim.fade_in, android.R.anim.fade_out);
                        } catch (Exception e) { /* cosmetic only */ }
                    }
                });
            }
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

    // ── In-app picker ───────────────────────────────────────────────────────
    // The system picker cannot be themed — it belongs to com.android.soundpicker
    // — so the app draws its own list and only needs the sounds themselves from
    // here. pick() above is kept for the "More sounds" row, which is the way to
    // reach anything this enumeration does not cover (Music, Files, themes).

    /** Every sound of the relevant type, as { title, uri } pairs. */
    @PluginMethod
    public void list(PluginCall call) {
        String type = call.getString("type");
        if (keyFor(type) == null) { call.reject("Unknown alert type: " + type); return; }

        JSArray items = new JSArray();
        try {
            RingtoneManager rm = new RingtoneManager(getContext());
            rm.setType(pickerTypeFor(type));
            // Silent entries would look like a broken row in the list, and the
            // app already offers Default; the system's own "Silent" is covered
            // by the mute control on the Messages screen.
            rm.setStopPreviousRingtone(true);
            Cursor c = rm.getCursor();
            if (c != null) {
                for (int i = 0; i < c.getCount(); i++) {
                    try {
                        c.moveToPosition(i);
                        String title = c.getString(RingtoneManager.TITLE_COLUMN_INDEX);
                        Uri uri = rm.getRingtoneUri(i);
                        if (uri == null) continue;
                        JSObject o = new JSObject();
                        o.put("title", (title == null || title.isEmpty()) ? uri.getLastPathSegment() : title);
                        o.put("uri", uri.toString());
                        items.put(o);
                    } catch (Exception rowErr) {
                        // One unreadable entry must not lose the whole list.
                    }
                }
            }
        } catch (Exception e) {
            call.reject("Could not read the phone's sounds: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("items", items);
        ret.put("current", uriString(keyFor(type)));
        call.resolve(ret);
    }

    private String uriString(String key) {
        Uri u = getUri(getContext(), key);
        return (u == null) ? null : u.toString();
    }

    // One preview at a time, held statically so a second tap can stop the first
    // even though each call arrives on its own plugin invocation.
    private static Ringtone activePreview = null;

    private static synchronized void stopActivePreview() {
        try {
            if (activePreview != null && activePreview.isPlaying()) activePreview.stop();
        } catch (Exception e) { /* already gone */ }
        activePreview = null;
    }

    @PluginMethod
    public void preview(PluginCall call) {
        String uriStr = call.getString("uri");
        stopActivePreview();
        if (uriStr == null || uriStr.isEmpty()) { call.resolve(); return; }
        try {
            Ringtone r = RingtoneManager.getRingtone(getContext(), Uri.parse(uriStr));
            if (r != null) {
                activePreview = r;
                r.play();
            }
        } catch (Exception e) {
            // A sound that will not play is not worth an error dialog; the row
            // simply stays silent and the user picks another.
        }
        call.resolve();
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        stopActivePreview();
        call.resolve();
    }

    /** Save a choice made in the app's own list. Empty uri means Default. */
    @PluginMethod
    public void set(PluginCall call) {
        String key = keyFor(call.getString("type"));
        if (key == null) { call.reject("Unknown alert type"); return; }
        String uriStr = call.getString("uri");

        stopActivePreview();
        SharedPreferences.Editor ed = prefs().edit();
        if (uriStr == null || uriStr.isEmpty()) ed.remove(key);
        else                                    ed.putString(key, uriStr);
        ed.apply();

        // The message tone is a notification-channel property, and a channel's
        // sound cannot be changed after creation — see pickResult().
        if (KEY_MESSAGE.equals(key)) {
            MyFirebaseMessagingService.rebuildMessageChannel(getContext());
        }

        JSObject ret = new JSObject();
        ret.put("title", titleFor(key, "Default"));
        call.resolve(ret);
    }

    // ── Pick a sound from the music app or the file manager ─────────────────
    // What is missing from the app's own list is everything that is not a
    // registered ringtone: a song, a downloaded clip, a recording. Those live
    // in two different places, so the sheet offers two buttons and `source`
    // says which was tapped:
    //
    //   "music" → the phone's music app and its song list, via GET_CONTENT
    //             addressed straight at the music player it resolves to.
    //   "files" → the file manager, via the storage-access framework.
    //
    // They cannot be one intent. GET_CONTENT reaches the music app but hands
    // back a one-shot uri; OPEN_DOCUMENT gives a uri that survives a reboot but
    // is only ever answered by the documents UI. Each source gets the intent
    // that actually reaches it, and the weaker grant is made up for by the
    // media permission asked for below.
    @PluginMethod
    public void pickFile(PluginCall call) {
        String type = call.getString("type");
        if (keyFor(type) == null) { call.reject("Unknown alert type: " + type); return; }

        // The music route needs the media permission to keep reading the song
        // later; ask before the picker rather than after a choice is made.
        if (isMusicSource(call)) {
            String alias = audioAlias();
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                requestPermissionForAlias(alias, call, "musicPermissionResult");
                return;
            }
        }
        openFilePicker(call);
    }

    @PermissionCallback
    private void musicPermissionResult(PluginCall call) {
        // Opened either way. A refused permission still leaves the picker
        // working for this choice — the result carries its own read grant —
        // and showing nothing at all would be a worse answer than a sound that
        // may need re-picking later.
        openFilePicker(call);
    }

    private static boolean isMusicSource(PluginCall call) {
        return "music".equals(call.getString("source"));
    }

    /** The media permission this Android version actually has. */
    private static String audioAlias() {
        return (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            ? PERM_AUDIO : PERM_AUDIO_LEGACY;
    }

    private void openFilePicker(PluginCall call) {
        try {
            Intent i = isMusicSource(call) ? musicIntent() : filesIntent();

            call.setKeepAlive(true);
            getBridge().saveCall(call);
            startActivityForResult(call, i, "pickFileResult");

            final Activity host = getActivity();
            if (host != null) {
                host.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try {
                            host.overridePendingTransition(
                                android.R.anim.fade_in, android.R.anim.fade_out);
                        } catch (Exception e) { /* cosmetic only */ }
                    }
                });
            }
        } catch (Exception e) {
            call.reject("Could not open the sound picker: " + e.getMessage());
        }
    }

    /**
     * The music app's own song list.
     *
     * GET_CONTENT is the only action a music player answers, and on the test
     * phone three apps answer it — the player, the file explorer and the
     * documents UI. Left implicit that is a chooser, which is exactly the
     * screen two separate buttons exist to avoid, so the player is resolved and
     * addressed directly. Needs the GET_CONTENT audio/* <queries> entry in
     * AndroidManifest.xml to see it at all.
     *
     * Falls back to the implicit intent when no music app can be identified: a
     * chooser is a poor answer but a dead button is a worse one.
     */
    private Intent musicIntent() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("audio/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            for (ResolveInfo ri : getContext().getPackageManager().queryIntentActivities(i, 0)) {
                if (ri == null || ri.activityInfo == null) continue;
                ActivityInfo a = ri.activityInfo;
                if (looksLikeMusicApp(a.packageName, a.name)) {
                    i.setClassName(a.packageName, a.name);
                    break;
                }
            }
        } catch (Exception e) {
            // Any doubt and the implicit intent still works, chooser and all.
        }
        return i;
    }

    /**
     * Is this GET_CONTENT handler a music player rather than a browser of files?
     * Judged by package and activity name because nothing declares it. The file
     * managers are ruled out first, since one of them — MIUI's
     * PickAudioActivity — has "audio" in its name too.
     */
    private static boolean looksLikeMusicApp(String pkg, String cls) {
        String p = (pkg == null) ? "" : pkg.toLowerCase();
        String c = (cls == null) ? "" : cls.toLowerCase();
        if (p.contains("documentsui") || p.contains("fileexplorer")
            || p.contains("filemanager") || p.contains("files")
            || p.contains("soundrecorder")) return false;
        return p.contains("music") || p.contains("player") || p.contains("audio")
            || c.contains("music") || c.contains("audiopicker");
    }

    /**
     * The file manager, through the storage-access framework. Only the
     * documents UI answers OPEN_DOCUMENT, so this needs no targeting and shows
     * no chooser — and it is the one route whose uri is persistable, which is
     * what an alert sounding days later depends on.
     */
    private Intent filesIntent() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("audio/*");
        // The chosen file has to stay readable after this activity ends —
        // the alert may not sound until days later, in another process.
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                 | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        return i;
    }

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                JSObject ret = new JSObject();
                ret.put("changed", false);
                call.resolve(ret);
                return;
            }

            Uri uri = result.getData().getData();
            String key = keyFor(call.getString("type"));
            if (uri == null || key == null) {
                JSObject ret = new JSObject();
                ret.put("changed", false);
                call.resolve(ret);
                return;
            }

            // Hold the read grant across reboots, or the sound goes silent the
            // next time the phone restarts. Only the storage-access framework
            // grants this; a song from the music app throws here and is covered
            // by the media permission asked for in pickFile() instead.
            try {
                getContext().getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) { /* not a SAF uri; the media permission covers it */ }

            // A notification channel is played by the system, not by this app,
            // so the system needs its own read grant on the file. Without this
            // the channel falls silent with no error anywhere.
            for (String pkg : new String[] { "com.android.systemui", "android" }) {
                try {
                    getContext().grantUriPermission(
                        pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception e) { /* best effort */ }
            }

            prefs().edit().putString(key, uri.toString()).apply();

            if (KEY_MESSAGE.equals(key)) {
                MyFirebaseMessagingService.rebuildMessageChannel(getContext());
            }

            JSObject ret = new JSObject();
            ret.put("changed", true);
            ret.put("title", fileTitle(uri, key));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the selection: " + e.getMessage());
        }
    }

    /**
     * Display name for a picked file. RingtoneManager can title a registered
     * ringtone but knows nothing about an arbitrary document, so the provider
     * is asked for its display name first.
     */
    private String fileTitle(Uri uri, String key) {
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = c.getString(idx);
                    if (name != null && !name.isEmpty()) {
                        int dot = name.lastIndexOf('.');
                        return (dot > 0) ? name.substring(0, dot) : name;
                    }
                }
            }
        } catch (Exception e) { /* fall through */ }
        return titleFor(key, "Default");
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
