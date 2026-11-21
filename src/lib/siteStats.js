/**
 * Our own counter for the public website (see supabase/migrations/20261118120000_site_events.sql).
 *
 * Two events: `page_view` (the ad page opened) and `download_click` (a Google Play button tapped).
 * Each carries the utm_ keys from the address, whether the page is inside the Instagram / Facebook
 * browser, and the phone platform. No IP, no user agent, no id. Failures are swallowed: a counter
 * must never get in the way of the button.
 *
 * Sent with fetch + keepalive so the request still completes when the tap navigates away to Play.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign']

/** The pieces of the address and browser we record. Pure, so it can be tested. */
export function siteEventContext(search = '', ua = '') {
  let params
  try { params = new URLSearchParams(search) } catch { params = new URLSearchParams('') }
  const utm = (key) => (params.get(key) || '').trim().slice(0, 80) || null
  return {
    p_utm_source: utm(UTM_KEYS[0]),
    p_utm_medium: utm(UTM_KEYS[1]),
    p_utm_campaign: utm(UTM_KEYS[2]),
    p_in_app: /Instagram|FBAN|FBAV|FB_IAB/i.test(ua),
    p_platform: /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other',
  }
}

/** @param {'page_view'|'download_click'} event  @param {string} [placement] which button, e.g. 'hero' */
export function logSiteEvent(event, placement = '') {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY || typeof window === 'undefined') return
    const body = {
      p_event: event,
      p_placement: placement || null,
      ...siteEventContext(window.location.search, navigator.userAgent || ''),
    }
    fetch(`${SUPABASE_URL}/rest/v1/rpc/log_site_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  } catch { /* never block the page or the button */ }
}

/** Count a page view once per browser tab session, so a refresh does not inflate it. */
export function logPageViewOnce() {
  try {
    if (window.sessionStorage.getItem('kinest_pv')) return
    window.sessionStorage.setItem('kinest_pv', '1')
  } catch { /* storage blocked: count it anyway */ }
  logSiteEvent('page_view')
}
