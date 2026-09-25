package com.scoopfamily.familyguard;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

/**
 * "SOS" in Quick Settings: swipe down, one tap, and the same 3-second countdown
 * as the other native triggers starts — Cancel on screen and in the shade, then
 * an alert to every family. Nothing is sent by the tap itself.
 *
 * Why a tile: it is the one shortcut a normal app can offer that is reachable
 * from a LOCKED phone, cannot be pressed in a pocket, and needs no special
 * permission. See FakeCallTileService, which it mirrors.
 *
 * Off unless the member turns it on (Profile → Safety): the component ships
 * disabled in the manifest and {@link #setEnabled} flips it, so a member who
 * never opts in has no SOS tile on offer at all. Disabling it also takes an
 * already-added tile out of the panel.
 */
public class SosTileService extends TileService {

    private static final String TAG = "SOS_Arming";

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setLabel(getString(R.string.sos_tile_label));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(R.string.sos_tile_subtitle));
        }
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_sos_alert));
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Context app = getApplicationContext();
        // All families, as for Shake: from a lock screen there is no way to choose.
        SosArming.arm(app, "qs-tile", SosArming.GRACE_MS, true);

        // arm() starts the countdown screen itself, but the Quick Settings panel
        // would stay drawn over it. Collapsing the panel through the tile's own
        // launch call is also the start the system reliably allows from a tile;
        // the screen is singleTask, so a second start just lands in onNewIntent.
        Intent countdown = SosCountdownActivity.intent(app, SosArming.GRACE_MS);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(app, 4802, countdown,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            } else {
                startActivityAndCollapse(countdown);
            }
        } catch (Exception e) {
            // The countdown notification with Cancel is still posted by arm().
            Log.w(TAG, "tile could not open the countdown screen: " + e.getMessage());
        }
    }

    // ── On/off, driven from the Safety page ──────────────────────────────────

    static boolean isEnabled(Context ctx) {
        int s = ctx.getPackageManager().getComponentEnabledSetting(component(ctx));
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    static void setEnabled(Context ctx, boolean enabled) {
        ctx.getPackageManager().setComponentEnabledSetting(component(ctx),
            enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
    }

    static ComponentName component(Context ctx) {
        return new ComponentName(ctx, SosTileService.class);
    }
}
