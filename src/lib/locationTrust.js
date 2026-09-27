// Which position fixes are believed enough to move a family member's pin.
// The same rules as LocationFilter.java / TeleportGuard.java on Android, for the
// web path (useLocationBroadcast). Pure, so they are unit-tested.
//
// A fix that is not trusted is dropped and the last accepted position stays on
// the map. Nothing here smooths or invents a position: a fix is either written
// as it was reported, or not written at all.

export const MAX_ACCURACY_M = 100        // normal ceiling once a position is on the map
export const EVIDENCE_ACCURACY_M = 200   // hard ceiling, and only with strong evidence of travel
export const FIRST_FIX_ACCURACY_M = 2000 // nothing on the map yet: a rough position beats none
export const STALE_FIX_MS = 30_000       // older than this is a cached memory, not a reading
export const STRONG_SPEED_MPS = 3        // ~11 km/h reported by the fix itself
export const MIN_TRAVEL_MPS = 1          // and the displacement since the last write must agree

/** A fix stamped long ago is the provider's cache, not where the phone is now. */
export function isStaleFix(fixTimeMs, nowMs = Date.now()) {
  return Number.isFinite(fixTimeMs) && nowMs - fixTimeMs > STALE_FIX_MS
}

/**
 * Strong evidence the member is travelling: the fix reports a real speed AND the
 * distance since the last accepted position agrees with it. One of the two alone
 * is what a jumpy Wi-Fi guess looks like.
 */
export function hasStrongMotionEvidence({ speedMps, movedM, msSinceLast }) {
  if (!Number.isFinite(speedMps) || speedMps < STRONG_SPEED_MPS) return false
  if (!Number.isFinite(movedM) || !(msSinceLast > 0)) return false
  return movedM / (msSinceLast / 1000) >= MIN_TRAVEL_MPS
}

/** The worst accuracy this fix may have and still be believed. */
export function accuracyLimit({ hasBaseline, speedMps, movedM, msSinceLast }) {
  if (!hasBaseline) return FIRST_FIX_ACCURACY_M
  return hasStrongMotionEvidence({ speedMps, movedM, msSinceLast })
    ? EVIDENCE_ACCURACY_M
    : MAX_ACCURACY_M
}
