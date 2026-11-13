/**
 * Public-website settings. This is the one place to edit when the launch
 * details arrive; nothing else in the code needs to change.
 *
 * PLAY_STORE_URL: paste the real Google Play link here once the app is public
 * (https://play.google.com/store/apps/details?id=... ). While it is empty the
 * "Get it on Google Play" button is shown but is not a link, because a link to
 * an unpublished app is a dead end. Do not guess it.
 *
 * CONTACT_PHONE: the support phone number. Empty means the phone row is left
 * out of the Contact page in production (a made-up number must never reach
 * visitors). In a development build the row appears with an obvious
 * placeholder so the layout can be checked.
 */
export const SITE_URL = 'https://www.kinest.co.in'
const PLAY_BASE = 'https://play.google.com/store/apps/details?id=com.scoopfamily.familyguard'
const DEFAULT_REFERRER = 'utm_source=website&utm_medium=landing'
export const PLAY_STORE_URL = `${PLAY_BASE}&referrer=${encodeURIComponent(DEFAULT_REFERRER)}`

/**
 * The Play link for a visitor, carrying the campaign they arrived with.
 *
 * An ad link such as https://www.kinest.co.in/?utm_source=meta&utm_campaign=reel1
 * is handed on to Play as its install referrer, so Play Console shows which ad
 * produced which install. Only the five standard utm_ keys are passed on, each
 * trimmed and length-limited; anything else in the address is ignored. With no
 * utm_ keys the default website referrer is used.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
export function playStoreUrlFor(search = '') {
  let params
  try { params = new URLSearchParams(search) } catch { return PLAY_STORE_URL }
  const kept = []
  for (const key of UTM_KEYS) {
    const value = (params.get(key) || '').trim().slice(0, 80)
    if (value) kept.push(`${key}=${encodeURIComponent(value)}`)
  }
  if (!kept.length) return PLAY_STORE_URL
  return `${PLAY_BASE}&referrer=${encodeURIComponent(kept.join('&'))}`
}
export const CONTACT_EMAIL = 'support@kinest.co.in'
export const CONTACT_PHONE = ''
export const SUPPORT_NAME = 'Kinest Customer Support'
