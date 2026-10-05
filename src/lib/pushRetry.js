/**
 * pushRetry.js
 *
 * How long to wait before asking Firebase for the phone's push token again
 * after it failed.
 *
 * Why this exists: on some phones Google Play services answers
 * SERVICE_NOT_AVAILABLE for a while (seen after a reinstall, and on MIUI). The
 * app asked once, failed, and never asked again, so the account signed in on
 * the phone never claimed its token. Two bad things follow: that account
 * receives nothing while closed, and an older account that once used the phone
 * keeps its record pointing at it, so it keeps receiving the family's alerts,
 * including the sender's own SOS on the sender's own phone.
 *
 * The delays grow so a phone that is genuinely offline does not spin, and the
 * list ends: after the last attempt the next app launch asks again anyway.
 */
export const PUSH_RETRY_DELAYS_MS = [20_000, 60_000, 180_000, 600_000]

/** Delay before retry number `attempt` (0 for the first retry), or null when out of retries. */
export function nextPushRetryDelay(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) return null
  return attempt < PUSH_RETRY_DELAYS_MS.length ? PUSH_RETRY_DELAYS_MS[attempt] : null
}
