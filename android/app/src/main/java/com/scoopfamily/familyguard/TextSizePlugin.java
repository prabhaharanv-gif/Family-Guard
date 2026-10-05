package com.scoopfamily.familyguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Profile -> Text size.
 *
 * Sets the WebView's text zoom, which scales ALL of the app's text, whatever unit
 * the stylesheet used. The choice is stored here and re-applied on every launch
 * (MainActivity), before the first page is drawn, so the screen does not jump from
 * the phone's size to the chosen one a moment after opening.
 *
 * See TextSizeLevel for why the default is Normal rather than the phone's size.
 */
@CapacitorPlugin(name = "TextSize")
public class TextSizePlugin extends Plugin {

    static final String KEY_LEVEL = "text_size_level";

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(MyFirebaseMessagingService.PREF_NAME, Context.MODE_PRIVATE);
    }

    /** Reads the saved level and applies it. Called from MainActivity at launch. */
    static void applySaved(Context ctx, WebView webView) {
        if (webView == null) return;
        String level = TextSizeLevel.normalize(prefs(ctx).getString(KEY_LEVEL, null));
        apply(ctx, webView, level);
    }

    private static void apply(Context ctx, WebView webView, String level) {
        webView.getSettings().setTextZoom(TextSizeLevel.percentFor(level));
    }

    @PluginMethod
    public void getLevel(PluginCall call) {
        JSObject r = new JSObject();
        r.put("level", TextSizeLevel.normalize(prefs(getContext()).getString(KEY_LEVEL, null)));
        call.resolve(r);
    }

    @PluginMethod
    public void setLevel(PluginCall call) {
        final String level = TextSizeLevel.normalize(call.getString("level"));
        prefs(getContext()).edit().putString(KEY_LEVEL, level).apply();
        // WebSettings must be touched on the UI thread.
        getActivity().runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                apply(getContext(), getBridge().getWebView(), level);
            }
            JSObject r = new JSObject();
            r.put("level", level);
            call.resolve(r);
        });
    }
}
