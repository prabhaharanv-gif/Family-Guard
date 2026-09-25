package com.scoopfamily.familyguard;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.telephony.SignalStrength;
import android.telephony.TelephonyManager;

/**
 * What network this phone is on right now, for the family card: Wi-Fi or
 * mobile data, with a 0-4 bar level. Sent with every position by
 * LocationForegroundService, so it costs no extra wake-ups.
 *
 * Needs no runtime permission: ACCESS_NETWORK_STATE is a normal permission,
 * and TelephonyManager.getSignalStrength() asks for none from API 28.
 *
 * No network at all gives type null. The push would not get through anyway,
 * and the server keeps the last reading with its own timestamp (signal_at),
 * which the card greys out once it is old.
 */
final class NetworkSignal {

    static final String WIFI     = "wifi";
    static final String CELLULAR = "cellular";

    /** type is null when not connected; level is -1 when unknown. */
    static final class Reading {
        final String type;
        final int level;
        Reading(String type, int level) { this.type = type; this.level = level; }
    }

    private NetworkSignal() {}

    static Reading read(Context ctx) {
        try {
            ConnectivityManager cm =
                (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return new Reading(null, -1);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            if (caps == null) return new Reading(null, -1);

            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                int rssi = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? caps.getSignalStrength() : NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED;
                return new Reading(WIFI, rssi == NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED
                    ? -1 : wifiBars(rssi));
            }
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                return new Reading(CELLULAR, cellularBars(ctx));
            }
            // Ethernet, VPN over something else, etc.: connected, kind unknown.
            return new Reading(null, -1);
        } catch (Exception e) {
            return new Reading(null, -1);
        }
    }

    private static int cellularBars(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return -1;
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            SignalStrength s = tm == null ? null : tm.getSignalStrength();
            return s == null ? -1 : clampBars(s.getLevel());
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * Wi-Fi RSSI in dBm to 0-4 bars. The same breakpoints Android's own status
     * bar uses on most builds: -55 and up is full, below -88 is nothing usable.
     */
    static int wifiBars(int rssiDbm) {
        if (rssiDbm >= -55) return 4;
        if (rssiDbm >= -66) return 3;
        if (rssiDbm >= -77) return 2;
        if (rssiDbm >= -88) return 1;
        return 0;
    }

    /** SignalStrength.getLevel() is documented 0-4; anything else is treated as unknown. */
    static int clampBars(int level) {
        return level >= 0 && level <= 4 ? level : -1;
    }
}
