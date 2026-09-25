package com.scoopfamily.familyguard;

/**
 * What the SOS sender actually needs, as carried by a nearby-help request
 * (help_kind on nearby_help_escalations / nearby_help_notifications). A helper
 * is asked to call the service that matches: an ambulance SOS sends them to
 * 108, not the police.
 *
 * The numbers mirror the SOS tiles in src/pages/SOSPage.jsx (QUICK_MESSAGES).
 * Unknown or missing kinds fall back to police, the safe default.
 */
final class NearbyHelpKind {
    private NearbyHelpKind() {}

    static String number(String kind) {
        if ("ambulance".equals(kind) || "disaster".equals(kind)) return "108";
        if ("fire".equals(kind)) return "112";
        return "100";
    }

    /** "the police" / "an ambulance" / ... — fits "needs %s". */
    static int needRes(String kind) {
        if ("ambulance".equals(kind)) return R.string.kind_need_ambulance;
        if ("disaster".equals(kind))  return R.string.kind_need_disaster;
        if ("fire".equals(kind))      return R.string.kind_need_fire;
        return R.string.kind_need_police;
    }
}
