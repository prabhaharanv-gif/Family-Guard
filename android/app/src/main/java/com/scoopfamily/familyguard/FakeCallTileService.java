package com.scoopfamily.familyguard;

import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

/**
 * "Call me" in Quick Settings: swipe down, one tap, and a fake call rings a few
 * seconds later.
 *
 * This exists because the trigger people ask for — holding a volume button —
 * cannot work. MIUI never hands volume keys to a background app (measured twice
 * on the test phone; see the volume-hold spike notes), and the power button is
 * India's panic-button gesture, which dials 112. A Quick Settings tile is the
 * one shortcut a normal app can offer that is reachable from a LOCKED phone,
 * cannot be pressed by accident in a pocket, and needs no special permission.
 *
 * The work is done in onClick without unlockAndRun: nothing here shows UI, so
 * the phone stays locked and the call arrives on the lock screen like any other.
 */
public class FakeCallTileService extends TileService {

    private static final String TAG = "FakeCall";

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setLabel(getString(R.string.fake_call_notification_action));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(R.string.fake_call_tile_subtitle));
        }
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_fake_call_answer));
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        try {
            FakeCallService.schedule(getApplicationContext(), FakeCallPrefs.NOTIFICATION_DELAY_S);
            Log.i(TAG, "fake call scheduled from the Quick Settings tile");
        } catch (Exception e) {
            // A refused start must not look like nothing happened, so it is
            // logged; the tile itself cannot show an error.
            Log.w(TAG, "tile could not schedule the call: " + e.getMessage());
        }

        Tile tile = getQsTile();
        if (tile == null) return;
        // Lit while the call is on its way, then back to normal. Purely feedback:
        // the tile has no state of its own to keep.
        tile.setState(Tile.STATE_ACTIVE);
        tile.updateTile();
    }

    @Override
    public void onStopListening() {
        Tile tile = getQsTile();
        if (tile != null) {
            tile.setState(Tile.STATE_INACTIVE);
            tile.updateTile();
        }
        super.onStopListening();
    }
}
