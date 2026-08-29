package com.scoopfamily.familyguard;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge so the React app can:
 *   - stop the native SOS siren
 *   - check if the siren is running
 *   - detect the device manufacturer (to warn Xiaomi/OPPO/Vivo users)
 *   - open the OEM autostart / background-popup settings pages
 *   - check whether full-screen-intent permission is granted (Android 14+)
 *
 * On MIUI (Xiaomi/Redmi/POCO), ColorOS (OPPO/Realme) and FuntouchOS (Vivo),
 * a killed app cannot show a full-screen SOS alert over the lock screen unless
 * the user has manually enabled "Autostart" and "Display pop-up windows while
 * running in background". These pages are OEM-specific and not reachable via
 * standard Android settings intents, so we deep-link to them directly.
 */
@CapacitorPlugin(name = "SOSAlarm")
public class SOSAlarmPlugin extends Plugin {

    /** Stop the siren service (audio + vibration) and clear the SOS notification. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Context ctx = getContext();
            SOSSirenService.stopService(ctx);
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop alarm: " + e.getMessage());
        }
    }

    /**
     * Start the SOS alert service — wakes the screen, vibrates, and shows the
     * full-screen alert over the lock screen.
     *
     * Called from the JS Realtime listener (useSosAlarm.js). That path receives
     * SOS inserts over the Supabase websocket while the app is alive, and until
     * now only played a Web Audio beep — JS cannot wake the screen. The native
     * screen-wake previously only ran from the FCM push path, so an SOS arriving
     * over the websocket left the display off.
     *
     * Note this deliberately adds no audio: SOSSirenService's synthesized siren
     * is disabled and its foreground notification uses the silent sos_popup_v1
     * channel, so this contributes screen-wake + vibration + the visual alert
     * only, and cannot reintroduce the duplicate alarm sound.
     */
    @PluginMethod
    public void trigger(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(ctx, SOSSirenService.class);
            i.putExtra("sender",  call.getString("sender",  "A family member"));
            i.putExtra("message", call.getString("message", "SOS Alert"));
            i.putExtra("lat",     call.getString("lat",     ""));
            i.putExtra("lng",     call.getString("lng",     ""));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }

            JSObject ret = new JSObject();
            ret.put("triggered", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to trigger SOS alert: " + e.getMessage());
        }
    }

    /** Is the foreground siren service currently running? */
    @PluginMethod
    public void isPlaying(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("playing", SOSSirenService.isRunning);
        call.resolve(ret);
    }

    /**
     * Returns device manufacturer + whether it is a "restrictive" OEM that needs
     * the extra autostart / background-popup permissions for SOS to work when
     * the app is killed. Also reports whether full-screen intents are allowed.
     */
    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String brand        = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();

        boolean isXiaomi = manufacturer.contains("xiaomi") || brand.contains("redmi")
                        || brand.contains("poco") || manufacturer.contains("redmi")
                        || manufacturer.contains("poco");
        boolean isOppo   = manufacturer.contains("oppo") || brand.contains("oppo")
                        || manufacturer.contains("realme") || brand.contains("realme");
        boolean isVivo   = manufacturer.contains("vivo") || brand.contains("vivo");
        boolean isHuawei = manufacturer.contains("huawei") || brand.contains("huawei")
                        || manufacturer.contains("honor") || brand.contains("honor");

        boolean isRestrictive = isXiaomi || isOppo || isVivo || isHuawei;

        // Full-screen intent permission status (Android 14+)
        boolean canFullScreen = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                canFullScreen = nm != null && nm.canUseFullScreenIntent();
            } catch (Exception e) { canFullScreen = false; }
        }

        String oem = isXiaomi ? "xiaomi" : isOppo ? "oppo" : isVivo ? "vivo"
                   : isHuawei ? "huawei" : "other";

        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("brand", Build.BRAND);
        ret.put("model", Build.MODEL);
        ret.put("oem", oem);
        ret.put("isRestrictive", isRestrictive);
        ret.put("canUseFullScreenIntent", canFullScreen);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /**
     * Opens the OEM-specific "Autostart" / permissions manager page.
     * Falls back to the standard app-details settings page if the OEM activity
     * is missing (some ROM versions rename these components).
     */
    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context ctx = getContext();
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String brand        = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();

        Intent intent = new Intent();
        boolean set = false;

        try {
            if (manufacturer.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")
                || manufacturer.contains("redmi") || manufacturer.contains("poco")) {
                // MIUI autostart manager
                intent.setComponent(new ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                set = true;
            } else if (manufacturer.contains("oppo") || manufacturer.contains("realme")
                    || brand.contains("oppo") || brand.contains("realme")) {
                intent.setComponent(new ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"));
                set = true;
            } else if (manufacturer.contains("vivo") || brand.contains("vivo")) {
                intent.setComponent(new ComponentName(
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
                set = true;
            } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                intent.setComponent(new ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                set = true;
            }

            if (set) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve(new JSObject().put("opened", true));
                return;
            }
        } catch (Exception e) {
            // OEM activity not found on this ROM version — fall through to app details
        }

        // Fallback: standard app details page
        try {
            Intent appDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            appDetails.setData(Uri.parse("package:" + ctx.getPackageName()));
            appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(appDetails);
            call.resolve(new JSObject().put("opened", true).put("fallback", true));
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    /**
     * Opens the standard App Details settings page — where the user finds
     * "Other permissions" (MIUI) containing "Display pop-up windows while
     * running in background" and "Show on lock screen".
     */
    @PluginMethod
    public void openAppDetailsSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    /**
     * Opens the Android 14+ "Full screen notifications" settings page for this
     * app, if the permission is not already granted.
     */
    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve(new JSObject().put("opened", true));
            } else {
                call.resolve(new JSObject().put("opened", false).put("notNeeded", true));
            }
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }
}
