package com.scoopfamily.familyguard;

/**
 * Lets a run of poor fixes move the pin, but only once they keep agreeing.
 *
 * LocationFilter drops any fix worse than 100m (200m with proof of travel). That
 * is right for one Wi-Fi guess, but it froze the pin for a member whose GPS stays
 * mediocre for a long time (dense streets, a bus): every fix was "too poor", so
 * a real 300m move was never shown. A single poor fix proves nothing; several in
 * a row that agree with EACH OTHER do — a guess lands somewhere new each time, a
 * phone that really moved stays put.
 *
 * So fixes between 100m and 500m are held as a candidate run, and the run is
 * believed when:
 *   - up to 200m: 2 reads that agree, spread over at least 20s
 *   - over 200m:  3 reads that agree, spread over at least 45s
 * Nothing better than 500m is ever believed this way, and the caller still
 * requires the run to sit outside the uncertainty of the position on the map and
 * to imply a physically possible speed. The position that is finally shown is
 * the reported fix itself — never an average, never nudged.
 *
 * Pure (no Android types, no clock): time is a parameter, so it runs on a JVM.
 */
final class CoarseFixConfirm {

    /** Worse than this is never used to move the pin. */
    static final float MAX_M = 500f;
    /** Up to here a shorter confirmation is enough. */
    static final float MODERATE_MAX_M = 200f;
    static final long  MODERATE_CONFIRM_MS = 20_000L;
    static final int   MODERATE_MIN_READS = 2;
    static final long  LOW_CONFIRM_MS = 45_000L;
    static final int   LOW_MIN_READS = 3;
    /** A run with a gap this long is over: the next fix starts a new one. */
    static final long  RUN_GAP_MS = 60_000L;

    static final float NO_DISTANCE = -1f;

    private boolean active = false;
    private long firstMs = 0L;
    private long lastMs = 0L;
    private int reads = 0;
    private float worstAccuracyM = 0f;

    void reset() { active = false; reads = 0; worstAccuracyM = 0f; }

    /**
     * True only when something OTHER than the poor fixes agreeing with each
     * other says the phone is actually moving: this fix's own reported speed
     * (Doppler-derived, usable even when its position accuracy is coarse), or
     * a proper GPS-quality fix that showed real movement within the last few
     * minutes.
     *
     * Without this, a phone sitting still whose Wi-Fi/cell position locks onto
     * one consistent WRONG point for a couple of minutes satisfies every other
     * check here — the fixes agree with each other, the distance is outside
     * their own uncertainty, the implied speed is plausible — exactly the
     * "phone lying still overnight" failure TeleportGuard and PlaceGeofence
     * were built to catch, which this class did not otherwise share.
     */
    static boolean hasMotionEvidence(boolean fixHasSpeed, float fixSpeedMps, boolean recentAccurateMotion) {
        return (fixHasSpeed && fixSpeedMps >= MIN_MOVING_SPEED_MPS) || recentAccurateMotion;
    }

    /**
     * Lower than LocationFilter.STRONG_SPEED_MPS (which asks for vehicle-grade
     * evidence, ~11km/h, to raise the accuracy ceiling itself). A walking
     * member with GPS that never gets better than 100-200m for the whole walk
     * is exactly the case this class exists for, and a phone's Doppler-derived
     * speed reading is usable even when its position accuracy is coarse — so
     * this only needs to clear ordinary GPS noise, not prove vehicle speed.
     */
    static final float MIN_MOVING_SPEED_MPS = 0.5f;

    boolean isActive() { return active; }

    /**
     * Records one poor fix and says whether the run is now believed.
     *
     * @param accuracyM         this fix's accuracy.
     * @param fromPreviousM     distance from the previous fix in the run, or NO_DISTANCE.
     * @param previousAccuracyM that previous fix's accuracy, or NO_DISTANCE.
     */
    boolean offer(float accuracyM, float fromPreviousM, float previousAccuracyM, long nowMs) {
        if (accuracyM > MAX_M) { reset(); return false; }

        // Two fixes agree when they lie within the larger of their own errors.
        boolean agrees = active && fromPreviousM != NO_DISTANCE && previousAccuracyM != NO_DISTANCE
            && fromPreviousM <= Math.max(accuracyM, previousAccuracyM)
            && nowMs - lastMs <= RUN_GAP_MS;

        if (!agrees) {
            active = true;
            firstMs = nowMs;
            reads = 0;
            worstAccuracyM = 0f;
        }
        lastMs = nowMs;
        reads++;
        worstAccuracyM = Math.max(worstAccuracyM, accuracyM);

        boolean low = worstAccuracyM > MODERATE_MAX_M;
        int  needReads = low ? LOW_MIN_READS : MODERATE_MIN_READS;
        long needMs    = low ? LOW_CONFIRM_MS : MODERATE_CONFIRM_MS;
        return reads >= needReads && nowMs - firstMs >= needMs;
    }
}
