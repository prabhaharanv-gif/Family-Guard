// A pin says "exactly here", but a phone indoors often only knows "somewhere
// within 60-250 m" (Wi-Fi or cell guess, few satellites). Drawing that doubt as a
// circle stops a loose fix from looking like a wrong one: two people sitting
// together can show 200 m apart, and the circle shows the pins overlap in truth.
//
// Below SHOW_ABOVE_M the fix is as good as a pin, so no circle. The radius is
// capped so one wild reading cannot paint half the map.

export const SHOW_ABOVE_M = 50
export const MAX_RADIUS_M = 500

/** Circle radius in metres for a location, or null when the pin is precise enough. */
export function accuracyRadius(loc) {
  const a = Number(loc?.accuracy)
  if (!Number.isFinite(a) || a <= SHOW_ABOVE_M) return null
  return Math.min(a, MAX_RADIUS_M)
}
