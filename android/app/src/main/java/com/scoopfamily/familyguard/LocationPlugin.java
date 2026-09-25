package com.scoopfamily.familyguard;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
@CapacitorPlugin(
    name = "LocationService",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.SEND_SMS }
        )
    }
)
public class LocationPlugin extends Plugin {

    /**
     * Whether the Activity is currently resumed.
     *
     * Read by LocationForegroundService to decide who may spend the Supabase
     * refresh token. Supabase rotates on redemption — using a refresh token
     * revokes it — so the WebView and the service cannot both refresh: whoever
     * goes second is told "Invalid Refresh Token: Already Used", supabase-js
     * treats that as unrecoverable and erases the session, and the user lands
     * on the login screen having done nothing.
     *
     * While this is true the WebView owns the token and pushes each new pair
     * down through updateSessionToken(); the service defers. While it is false
     * the app may not even be running, so the service owns it and JS adopts
     * whatever it holds on the way back in (lib/nativeSession.js).
     *
     * Defaults to false, not true. Android can start this process for the
     * service alone, with no Activity and no WebView — on that path nothing
     * would ever call handleOnResume, and a default of true would have the
     * service deferring to a JS client that does not exist. False means the
     * service refreshes on its own until an Activity actually resumes, which
     * is the correct owner in that state.
     *
     * volatile because the service reads it from its own thread.
     */
    public static volatile boolean appInForeground = false;

    @Override
    public void handleOnResume() {
        super.handleOnResume();
        appInForeground = true;
    }

    @Override
    public void handleOnPause() {
        super.handleOnPause();
        appInForeground = false;
    }

    /**
     * Requests ACCESS_BACKGROUND_LOCATION at runtime.
     *
     * WHY THIS EXISTS: @capacitor/geolocation's requestPermissions() only asks
     * for FOREGROUND location (fine/coarse). On Android 10+ background location
     * is a SEPARATE permission that must be requested on its own — without this,
     * Android never offers the user the "Allow all the time" option, so the pin
     * freezes the moment the app is backgrounded. This method triggers that
     * second prompt (which on Android 11+ opens the system settings page where
     * the user selects "Allow all the time").
     *
     * Call this from JS AFTER foreground location is already granted.
     */
    /**
     * Battery level and whether the phone is on power, read straight from
     * BatteryManager.
     *
     * The web layer used navigator.getBattery() for this. Chromium has
     * deprecated the Battery Status API and reports it unreliably inside a
     * WebView — the charging flag in particular can stay stuck at whatever it
     * was when the page loaded. Because the JS location writer runs every 20s
     * while the app is open, that stale value kept overwriting the accurate one
     * this service already writes, so a phone showed as charging long after it
     * was unplugged.
     *
     * EXTRA_PLUGGED rather than BATTERY_STATUS: OEM optimised-charging pauses
     * current while still plugged in, which STATUS reports as not charging.
     */
    @PluginMethod
    public void getBatteryStatus(PluginCall call) {
        try {
            android.content.Intent b = getContext().registerReceiver(
                null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));

            JSObject ret = new JSObject();
            if (b == null) { ret.put("level", null); ret.put("charging", false); call.resolve(ret); return; }

            int level  = b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
            int scale  = b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
            int plug   = b.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0);

            if (level >= 0 && scale > 0) ret.put("level", Math.round((level / (float) scale) * 100f));
            else                         ret.put("level", null);
            // EXTRA_PLUGGED alone. BATTERY_STATUS lingers on CHARGING after the
            // cable is pulled — verified with `dumpsys battery unplug`, which
            // reported "USB powered: false" while status stayed 2 (CHARGING).
            // ORing STATUS in as a "safety net" therefore kept a phone showing
            // as charging after it was unplugged, which is the bug this was
            // meant to fix. EXTRA_PLUGGED is non-zero for every power source
            // (USB, AC, wireless, dock), so nothing is lost by dropping it.
            ret.put("charging", plug != 0);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("getBatteryStatus failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        // Below Android 10 there is no separate background permission — foreground covers it
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }

        if (hasBackgroundPermission()) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }

        requestPermissionForAlias("backgroundLocation", call, "backgroundPermCallback");
    }

    @PermissionCallback
    private void backgroundPermCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", hasBackgroundPermission());
        call.resolve(res);
    }

    /**
     * Everything that decides whether this phone is CAPABLE of reporting in the
     * background, in one call.
     *
     * These are the questions that actually explain a member who has gone dark.
     * Every one of them was previously invisible from anywhere but the phone
     * itself: a member could say — truthfully, as far as they knew — that they
     * had given the app everything it asked for, while background location sat
     * denied or the OEM's battery optimisation was free to kill the service.
     * Diagnosing that meant inferring it from gaps between timestamps.
     *
     * Reported while the phone is still working, which is the point: by the time
     * it goes silent it can no longer tell anyone anything, so the useful record
     * is the one taken beforehand.
     */
    @PluginMethod
    public void getDeviceHealth(PluginCall call) {
        JSObject res = new JSObject();
        res.put("bgLocation",       hasBackgroundPermission());
        res.put("batteryOptIgnored", isBatteryOptimizationIgnored());
        res.put("serviceRunning",   LocationForegroundService.isRunning);
        res.put("sharingEnabled",   LocationForegroundService.isSharingEnabled(getContext()));
        res.put("appVersion",       appVersion());
        res.put("androidSdk",       Build.VERSION.SDK_INT);
        call.resolve(res);
    }

    private String appVersion() {
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pi.getLongVersionCode() : pi.versionCode;
            return pi.versionName + " (" + code + ")";
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void hasBackgroundPermission(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", hasBackgroundPermission());
        call.resolve(res);
    }

    private boolean hasBackgroundPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Checks whether the app is exempt from battery optimization ("Doze").
     * When NOT exempt, Android throttles/kills the background location service
     * once the app is backgrounded or swiped away — the #1 cause of location
     * stopping when the app is closed.
     */
    @PluginMethod
    public void isBatteryOptimizationIgnored(PluginCall call) {
        JSObject res = new JSObject();
        res.put("ignored", isBatteryOptimizationIgnored());
        call.resolve(res);
    }

    private boolean isBatteryOptimizationIgnored() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;  // no Doze before Android 6
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /**
     * Opens the system dialog asking the user to exempt FamilyGuard from battery
     * optimization. Required for reliable background tracking — without this the
     * OS kills the service to save power. On many OEM phones (Xiaomi, Oppo, Vivo,
     * Realme, Samsung) this is mandatory for background location to survive the
     * app being closed.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                call.resolve();  // already exempt
                return;
            }
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Some OEMs block the direct-request intent — fall back to the
            // general battery optimization settings list.
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open battery optimization settings: " + e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String supabaseUrl   = call.getString("supabaseUrl");
        String supabaseKey   = call.getString("supabaseKey");
        String userId        = call.getString("userId");
        String familyId      = call.getString("familyId");
        String sessionToken  = call.getString("sessionToken", "");
        String refreshToken  = call.getString("refreshToken", "");

        if (supabaseUrl == null || supabaseKey == null || userId == null || familyId == null) {
            call.reject("Missing required parameters: supabaseUrl, supabaseKey, userId, familyId");
            return;
        }

        // Store credentials so the service can read them even after the app is killed.
        // The refresh token lets the service renew its own session natively once the
        // access token expires, instead of freezing when the app is closed.
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(
            LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(LocationForegroundService.KEY_URL,       supabaseUrl)
            .putString(LocationForegroundService.KEY_KEY,       supabaseKey)
            .putString(LocationForegroundService.KEY_USER_ID,   userId)
            .putString(LocationForegroundService.KEY_FAMILY_ID, familyId)
            .commit();
        // Through the broker, which refuses a refresh token already spent here.
        TokenBroker.store(prefs, sessionToken, refreshToken);

        LocationForegroundService.startService(ctx);
        call.resolve();
    }

    /**
     * Mirrors the member's show_location preference down to the native side and
     * applies it immediately — off stops tracking, on resumes it.
     *
     * The web layer knows this value; the native start paths did not, which is
     * why opting out used to last only until the next launch. Call it whenever
     * the preference is saved, and whenever the app observes it changing (it can
     * change on another device).
     */
    // ── Offline SMS alerts ───────────────────────────────────────────────────

    /** { enabled, extraNumber, hasPermission, recipients } — recipients is a count, not the numbers. */
    @PluginMethod
    public void getOfflineSms(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", OfflineSms.isEnabled(getContext()));
        r.put("extraNumber", OfflineSms.extraNumber(getContext()));
        r.put("hasPermission", OfflineSms.hasPermission(getContext()));
        r.put("recipients", OfflineSms.recipients(getContext()).size());
        call.resolve(r);
    }

    /** Saves the switch and the member's own extra number. */
    @PluginMethod
    public void setOfflineSms(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled");
            return;
        }
        OfflineSms.saveSettings(getContext(), enabled, call.getString("extraNumber", ""));
        call.resolve();
    }

    /**
     * Admin numbers and the member's own name, cached while there IS data so
     * they are available when there is not.
     */
    @PluginMethod
    public void setOfflineSmsContacts(PluginCall call) {
        java.util.List<String> admins = new java.util.ArrayList<>();
        com.getcapacitor.JSArray arr = call.getArray("admins");
        if (arr != null) {
            try {
                for (Object o : arr.toList()) if (o != null) admins.add(String.valueOf(o));
            } catch (Exception e) {
                call.reject("admins must be an array of phone numbers");
                return;
            }
        }
        OfflineSms.saveContacts(getContext(), admins, call.getString("senderName", ""));
        call.resolve();
    }

    /**
     * Sends one offline-alert SMS immediately, so someone can check the number
     * works without waiting 15 minutes offline. Resolves { sent }.
     */
    @PluginMethod
    public void sendTestOfflineSms(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sent", OfflineSms.sendTestNow(getContext(),
            LocationForegroundService.getLastKnownLocation()));
        call.resolve(r);
    }

    /** Asks for SEND_SMS. Called when the member turns offline alerts on, never before. */
    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (OfflineSms.hasPermission(getContext())) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermCallback");
    }

    @PermissionCallback
    private void smsPermCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", OfflineSms.hasPermission(getContext()));
        call.resolve(r);
    }

    /** "Shake for SOS": { enabled }. Off unless the member turned it on. */
    @PluginMethod
    public void getShakeSos(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", LocationForegroundService.isShakeSosEnabled(getContext()));
        r.put("serviceRunning", LocationForegroundService.isRunning);
        call.resolve(r);
    }

    @PluginMethod
    public void setShakeSos(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled");
            return;
        }
        LocationForegroundService.setShakeSosEnabled(getContext(), enabled);
        call.resolve();
    }

    /**
     * Wrong-password alert state: whether it is on, whether the optional photo is
     * on, and the three things it needs from Android (device admin, camera,
     * display-over-apps for the photo).
     */
    @PluginMethod
    public void getAntiTheft(PluginCall call) {
        JSObject r = new JSObject();
        android.content.Context c = getContext();
        r.put("enabled", AntiTheft.isEnabled(c));
        r.put("photo", AntiTheft.isPhotoEnabled(c));
        r.put("adminActive", AntiTheft.isAdminActive(c));
        r.put("cameraGranted", AntiTheft.cameraGranted(c));
        r.put("overlayGranted", MainActivity.canDrawOverlays(c));
        call.resolve(r);
    }

    @PluginMethod
    public void setAntiTheft(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled");
            return;
        }
        Boolean photo = call.getBoolean("photo", false);
        AntiTheft.setConfig(getContext(), enabled, photo != null && photo);
        call.resolve();
    }

    /** Opens Android's own dialog asking the owner to make Famora a device admin. */
    @PluginMethod
    public void requestAntiTheftAdmin(PluginCall call) {
        try {
            android.content.Intent i = new android.content.Intent(
                android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            i.putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                AntiTheft.adminComponent(getContext()));
            i.putExtra(android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Famora only asks to be told when the screen-lock password is entered wrongly. "
                + "It cannot lock, wipe or change your phone.");
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the device admin screen: " + e.getMessage());
        }
    }

    /** Gives device-admin status back; the wrong-password alert then cannot work. */
    @PluginMethod
    public void removeAntiTheftAdmin(PluginCall call) {
        try {
            android.app.admin.DevicePolicyManager dpm = (android.app.admin.DevicePolicyManager)
                getContext().getSystemService(android.content.Context.DEVICE_POLICY_SERVICE);
            if (dpm != null) dpm.removeActiveAdmin(AntiTheft.adminComponent(getContext()));
        } catch (Exception ignored) {}
        AntiTheft.setConfig(getContext(), false, false);
        call.resolve();
    }

    /** "Crash detection": { enabled }. Off unless the member turned it on. */
    @PluginMethod
    public void getCrashDetect(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", LocationForegroundService.isCrashSosEnabled(getContext()));
        r.put("serviceRunning", LocationForegroundService.isRunning);
        call.resolve(r);
    }

    @PluginMethod
    public void setCrashDetect(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled");
            return;
        }
        LocationForegroundService.setCrashSosEnabled(getContext(), enabled);
        call.resolve();
    }

    @PluginMethod
    public void setSharing(PluginCall call) {
        Boolean sharing = call.getBoolean("sharing");
        if (sharing == null) {
            call.reject("Missing required parameter: sharing");
            return;
        }
        LocationForegroundService.setSharingEnabled(getContext(), sharing);
        call.resolve();
    }

    /** Called right after any Places CRUD so a running service picks up the change now. */
    @PluginMethod
    public void refreshPlaces(PluginCall call) {
        LocationForegroundService.refreshPlaces(getContext());
        call.resolve();
    }

    /**
     * Stops tracking and forgets the stored session. Call on sign-out, before
     * the web layer tears the Supabase session down.
     */
    @PluginMethod
    public void clearSession(PluginCall call) {
        LocationForegroundService.clearSession(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LocationForegroundService.stopService(getContext());
        call.resolve();
    }

    /**
     * The service's last pushed fix — the one that already passed its accuracy
     * and jump filters — so the web heartbeat writes the SAME position to the
     * member's other families instead of fetching its own. It used to ask for a
     * low-accuracy fix of its own, and a 90m Wi-Fi guess written over the
     * service's 20m GPS fix is what made a still pin flip ~100m.
     * Resolves { found:false } when there is none.
     */
    @PluginMethod
    public void getLastFix(PluginCall call) {
        JSObject r = new JSObject();
        try {
            android.content.SharedPreferences p = getContext().getSharedPreferences(
                LocationForegroundService.PREF_NAME, android.content.Context.MODE_PRIVATE);
            long t = p.getLong(LocationForegroundService.KEY_LAST_TIME, 0L);
            r.put("found", t > 0L);
            if (t > 0L) {
                r.put("lat", Double.longBitsToDouble(p.getLong(LocationForegroundService.KEY_LAST_LAT, 0L)));
                r.put("lng", Double.longBitsToDouble(p.getLong(LocationForegroundService.KEY_LAST_LNG, 0L)));
                r.put("accuracy", (double) p.getFloat(LocationForegroundService.KEY_LAST_ACC, 0f));
                float sp = p.getFloat(LocationForegroundService.KEY_LAST_SPEED, -1f);
                if (sp >= 0f) r.put("speed", (double) sp);   // m/s, as the Geolocation API reports
                r.put("time", t);
            }
        } catch (Exception e) {
            r.put("found", false);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", LocationForegroundService.isRunning);
        call.resolve(result);
    }

    /**
     * Hand the service's current tokens back to JS.
     *
     * The service renews the session natively while the app is closed, and
     * Supabase rotates the refresh token on every renewal — the old one is
     * revoked the moment a new one is issued. The service persists the new
     * token here, but the WebView's localStorage still holds the old one, so
     * the next refresh from JS presents a revoked token, Supabase rejects it
     * as already used, and supabase-js erases the session: the user lands on
     * the login screen having done nothing wrong.
     *
     * JS already pushes its tokens down on every refresh (updateSessionToken).
     * This is the missing return path, so the WebView can adopt whatever the
     * service renewed while it was asleep.
     */
    @PluginMethod
    public void getSessionTokens(PluginCall call) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("sessionToken", prefs.getString(LocationForegroundService.KEY_SESSION, null));
        result.put("refreshToken", prefs.getString(LocationForegroundService.KEY_REFRESH, null));
        call.resolve(result);
    }

    /**
     * Called when the user's session token refreshes — update it so the
     * running service always uses a valid JWT for Supabase RPC calls.
     * Also updates the refresh token when provided, so the service can keep
     * renewing its own session natively after the app is closed.
     */
    @PluginMethod
    public void updateSessionToken(PluginCall call) {
        String token = call.getString("sessionToken");
        if (token == null) { call.reject("sessionToken required"); return; }
        String refreshToken = call.getString("refreshToken");
        // Through the broker: a push can arrive after the service has already
        // rotated past it, and storing that spent token would revoke the session
        // on the next renewal.
        TokenBroker.store(getContext()
            .getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE),
            token, refreshToken);
        call.resolve();
    }

    /**
     * Renews the session on behalf of supabase-js (src/lib/refreshBroker.js).
     *
     * Every refresh in the app — WebView and native — goes through TokenBroker's
     * lock, so the single-use refresh token is never spent twice. Resolves with
     * the server's status and body; status 0 means the server was not reached.
     */
    @PluginMethod
    public void redeemRefreshToken(PluginCall call) {
        String refreshToken = call.getString("refreshToken");
        String supabaseUrl  = call.getString("supabaseUrl");
        String supabaseKey  = call.getString("supabaseKey");
        if (refreshToken == null || supabaseUrl == null || supabaseKey == null) {
            call.reject("refreshToken, supabaseUrl and supabaseKey are required");
            return;
        }
        SharedPreferences prefs = getContext()
            .getSharedPreferences(LocationForegroundService.PREF_NAME, Context.MODE_PRIVATE);
        // Network work, and the lock may be held by a service refresh in flight.
        new Thread(() -> {
            TokenBroker.Result r = TokenBroker.redeem(prefs, supabaseUrl, supabaseKey, refreshToken);
            JSObject ret = new JSObject();
            ret.put("status", r.status);
            ret.put("body", r.body);
            call.resolve(ret);
        }, "token-broker").start();
    }
}
