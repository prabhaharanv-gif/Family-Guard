# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── R8 keep rules ─────────────────────────────────────────────────────────
# Readable crash traces; Crashlytics uploads the mapping file automatically.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# Capacitor finds plugins and their @PluginMethod methods by reflection, and
# JS calls them by name. Our own plugins must keep their names and methods.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * extends com.getcapacitor.Plugin { *; }
-keep public class * extends com.getcapacitor.Plugin { @com.getcapacitor.PluginMethod public *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# Components named in AndroidManifest.xml are kept by AAPT, but keep their
# constructors/lifecycle explicitly for services started by class name.
-keep class com.scoopfamily.familyguard.MainActivity { *; }

# Firebase / Play services / Maps ship their own consumer rules.
-dontwarn com.google.android.gms.**
-dontwarn org.slf4j.**

# Capacitor looks permission and activity-result callbacks up BY NAME at
# runtime (requestPermissionForAlias -> @PermissionCallback). Renaming them
# made it throw an NPE and crash the app on the first permission request.
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keep class * extends com.getcapacitor.Plugin { *; }

# R8 stripped the @CapacitorPlugin annotation type itself, so
# handle.getPluginAnnotation() came back null for the Geolocation plugin and
# requestPermissions fell into the legacy path and threw an NPE. The
# annotation classes must exist at runtime, and Capacitor's core and the
# official plugins are small and reflection-heavy: keep them whole.
-keep @interface com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class com.google.android.gms.maps.** { *; }
