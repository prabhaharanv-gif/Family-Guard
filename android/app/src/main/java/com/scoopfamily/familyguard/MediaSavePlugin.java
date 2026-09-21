package com.scoopfamily.familyguard;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Saves a chat photo or video into the phone's gallery.
 *
 * Chat media lives in a PRIVATE storage bucket and reaches the app as a
 * short-lived signed https URL, so the JS side cannot hand the gallery a file —
 * it hands this plugin the URL, and the download happens here, straight into
 * the gallery, without ever passing the bytes back across the bridge.
 *
 * Where it lands: Pictures/Famora for photos, Movies/Famora for videos, so a
 * family's saved media shows up as one album instead of scattered in Camera.
 *
 * Permissions: Android 10+ (API 29) lets an app add its own files to the
 * gallery through MediaStore with no permission at all. Android 7–9 still
 * needs WRITE_EXTERNAL_STORAGE — declared in the manifest with
 * maxSdkVersion="28" so newer phones never see it — and it is asked for only
 * on the first save, never up front.
 *
 * JS:  MediaSave.saveToGallery({ url, mime, name, savedText, failedText })
 *      → { saved: true } — the plugin also shows savedText / failedText as a
 *      toast, passed in already translated so every string stays in ui.js.
 */
@CapacitorPlugin(
    name = "MediaSave",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class MediaSavePlugin extends Plugin {

    private static final String TAG = "FamoraMediaSave";
    private static final String ALBUM = "Famora";

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String url  = call.getString("url");
        String mime = call.getString("mime");
        if (url == null || !url.startsWith("https:") || mime == null
                || !(mime.startsWith("image/") || mime.startsWith("video/"))) {
            call.reject("url (https) and an image/ or video/ mime are required");
            return;
        }

        // Android 7–9 only: the legacy public folder needs the storage permission.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermCallback");
            return;
        }
        saveInBackground(call);
    }

    @PermissionCallback
    private void storagePermCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveInBackground(call);
        } else {
            toast(call.getString("failedText"));
            call.reject("storage permission denied");
        }
    }

    private void saveInBackground(PluginCall call) {
        // Network + disk: never on the main thread.
        new Thread(() -> {
            try {
                save(call.getString("url"), call.getString("mime"), call.getString("name"));
                toast(call.getString("savedText"));
                JSObject ret = new JSObject();
                ret.put("saved", true);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "save failed: " + e);
                toast(call.getString("failedText"));
                call.reject("save failed: " + e.getMessage());
            }
        }, "famora-media-save").start();
    }

    private void save(String url, String mime, String name) throws Exception {
        boolean video = mime.startsWith("video/");
        String fileName = safeName(name, mime);

        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        int code = conn.getResponseCode();
        if (code != 200) throw new IllegalStateException("HTTP " + code);

        try (InputStream in = conn.getInputStream()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStore(in, video, mime, fileName);
            } else {
                saveToLegacyFolder(in, video, mime, fileName);
            }
        } finally {
            conn.disconnect();
        }
    }

    /** Android 10+: no permission, and IS_PENDING hides a half-written file. */
    private void saveViaMediaStore(InputStream in, boolean video, String mime, String fileName) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        Uri collection = video
            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH,
            (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/" + ALBUM);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = cr.insert(collection, v);
        if (item == null) throw new IllegalStateException("MediaStore refused the insert");
        try (OutputStream out = cr.openOutputStream(item)) {
            if (out == null) throw new IllegalStateException("no output stream");
            copy(in, out);
        } catch (Exception e) {
            cr.delete(item, null, null);   // never leave an empty entry in the gallery
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(item, done, null, null);
    }

    /** Android 7–9: write the file, then tell the media scanner it exists. */
    @SuppressWarnings("deprecation")
    private void saveToLegacyFolder(InputStream in, boolean video, String mime, String fileName) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(
            video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), ALBUM);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cannot create " + dir);
        File file = new File(dir, fileName);
        try (OutputStream out = new FileOutputStream(file)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(getContext(),
            new String[] { file.getAbsolutePath() }, new String[] { mime }, null);
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        out.flush();
    }

    /**
     * A file name the gallery will accept. Chat objects are stored as
     * <uuid>.<ext>, so the caller's name is used when given, otherwise a
     * timestamped Famora_… name; either way it keeps the right extension.
     */
    private static String safeName(String name, String mime) {
        String ext = extFor(mime);
        String base = (name == null || name.trim().isEmpty())
            ? "Famora_" + System.currentTimeMillis()
            : name.trim().replaceAll("[\\\\/:*?\"<>|]", "_");
        return base.toLowerCase().endsWith("." + ext) ? base : base + "." + ext;
    }

    private static String extFor(String mime) {
        switch (mime) {
            case "image/png":       return "png";
            case "image/webp":      return "webp";
            case "image/gif":       return "gif";
            case "image/heic":      return "heic";
            case "image/heif":      return "heif";
            case "video/quicktime": return "mov";
            case "video/3gpp":      return "3gp";
            case "video/webm":      return "webm";
            case "video/mp4":       return "mp4";
            default:                return mime.startsWith("video/") ? "mp4" : "jpg";
        }
    }

    private void toast(String text) {
        if (text == null || text.isEmpty() || getActivity() == null) return;
        getActivity().runOnUiThread(() ->
            Toast.makeText(getContext(), text, Toast.LENGTH_SHORT).show());
    }
}
