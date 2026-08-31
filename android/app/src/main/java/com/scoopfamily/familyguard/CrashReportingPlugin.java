package com.scoopfamily.familyguard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

/**
 * Bridge so the React layer can report into Crashlytics.
 *
 * Native crashes and ANRs are collected automatically by the SDK and need
 * nothing from here — that is the half that matters most, because an OEM
 * killing LocationForegroundService or the SOS siren blocking the main thread
 * only ever shows up on a handset we do not own.
 *
 * This plugin covers the other half: JavaScript errors. A React render that
 * throws is caught by ErrorBoundary and shows "Something went wrong", but the
 * process never dies, so Crashlytics would otherwise never hear about it — the
 * user sees a broken screen and we learn nothing.
 */
@CapacitorPlugin(name = "CrashReporting")
public class CrashReportingPlugin extends Plugin {

    /** Breadcrumb. Attached to whatever crash report comes next. */
    @PluginMethod
    public void log(PluginCall call) {
        try {
            String message = call.getString("message", "");
            if (message != null && !message.isEmpty()) {
                FirebaseCrashlytics.getInstance().log(message);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("log failed: " + e.getMessage());
        }
    }

    /**
     * Record a non-fatal JS error.
     *
     * A JS stack cannot be packed into a Java StackTraceElement[] without
     * inventing file/line data that would then be wrong in the console, so the
     * real stack goes in as a preceding log() breadcrumb and the exception
     * itself carries the message. The report shows both together.
     */
    @PluginMethod
    public void recordError(PluginCall call) {
        try {
            String message = call.getString("message", "Unknown JS error");
            String stack   = call.getString("stack", "");
            String context = call.getString("context", "");

            FirebaseCrashlytics crashlytics = FirebaseCrashlytics.getInstance();
            if (context != null && !context.isEmpty()) {
                crashlytics.log("context: " + context);
            }
            if (stack != null && !stack.isEmpty()) {
                crashlytics.log("js stack: " + stack);
            }
            crashlytics.recordException(new JavaScriptException(message));

            call.resolve();
        } catch (Exception e) {
            call.reject("recordError failed: " + e.getMessage());
        }
    }

    /**
     * Tag reports with the Supabase user id so a crash can be tied back to a
     * support message. It is an opaque UUID, not a name, email or phone number.
     */
    @PluginMethod
    public void setUserId(PluginCall call) {
        try {
            String userId = call.getString("userId", "");
            FirebaseCrashlytics.getInstance().setUserId(userId == null ? "" : userId);
            call.resolve();
        } catch (Exception e) {
            call.reject("setUserId failed: " + e.getMessage());
        }
    }

    /**
     * Consent switch. Collection stays off until the user has accepted the
     * privacy policy, and flips back off if they later withdraw. The setting
     * persists across launches, so this only needs calling when it changes.
     */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        try {
            Boolean enabled = call.getBoolean("enabled", Boolean.TRUE);
            FirebaseCrashlytics.getInstance()
                .setCrashlyticsCollectionEnabled(enabled != null && enabled);
            JSObject ret = new JSObject();
            ret.put("enabled", enabled != null && enabled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("setEnabled failed: " + e.getMessage());
        }
    }

    /** Named so JS errors are grouped separately from native ones in the console. */
    private static class JavaScriptException extends Exception {
        JavaScriptException(String message) { super(message); }
    }
}
