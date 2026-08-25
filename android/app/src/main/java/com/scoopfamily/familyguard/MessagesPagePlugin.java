package com.scoopfamily.familyguard;

import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MessagesPage")
public class MessagesPagePlugin extends Plugin {

    /** Called when Messages page mounts/unmounts — suppresses notification while open */
    @PluginMethod
    public void setOpen(PluginCall call) {
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) activity.setMessagesPageOpen(open);
        call.resolve();
    }

    /**
     * Called whenever the user changes the mute toggle.
     * level: 0 = all on, 1 = sound muted, 2 = sound + banner muted
     * Stored in SharedPreferences so MyFirebaseMessagingService reads it
     * even when this page is not mounted (e.g. app backgrounded, killed).
     */
    @PluginMethod
    public void setMuteLevel(PluginCall call) {
        int level = call.getInt("level", 0);
        SharedPreferences prefs = getContext()
            .getSharedPreferences(MyFirebaseMessagingService.PREF_NAME,
                android.content.Context.MODE_PRIVATE);
        prefs.edit()
            .putInt(MyFirebaseMessagingService.KEY_MUTE_LEVEL, level)
            .apply();
        call.resolve();
    }
}
