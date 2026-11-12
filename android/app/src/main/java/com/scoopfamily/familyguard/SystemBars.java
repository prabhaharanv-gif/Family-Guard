package com.scoopfamily.familyguard;

import android.app.Activity;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Edge-to-edge for the native full-screen activities, without the deprecated
 * setStatusBarColor / setNavigationBarColor / setSystemUiVisibility calls.
 *
 * Android 15+ draws edge-to-edge regardless and ignores bar colours, so every
 * version is treated the same: the window draws behind the bars, the window
 * background supplies the cream, and the content area is padded by the system
 * bar and cutout insets. Safe to call more than once.
 */
final class SystemBars {
    private SystemBars() {}

    static void applyCream(Activity activity, int cream) {
        Window w = activity.getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.setBackgroundDrawable(new ColorDrawable(cream));
        // Dark status/navigation icons, or they vanish on cream.
        androidx.core.view.WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(w, w.getDecorView());
        c.setAppearanceLightStatusBars(true);
        c.setAppearanceLightNavigationBars(true);

        View content = activity.findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
