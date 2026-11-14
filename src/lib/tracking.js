/**
 * Optional GA4 and Meta Pixel for the ad landing page.
 *
 * Nothing loads unless VITE_GA4_ID / VITE_META_PIXEL_ID are set at build time
 * (see siteConfig.js). Each script is added at most once, and if the page or an
 * earlier tag already defined gtag / fbq it is reused, never loaded again.
 * The only event sent is `download_click`, with no personal data: just which
 * button (hero, sticky, final) was tapped.
 */

import { GA4_ID, META_PIXEL_ID } from './siteConfig'

let started = false

function addScript(src) {
  const s = document.createElement('script')
  s.async = true
  s.src = src
  document.head.appendChild(s)
}

export function initTracking() {
  if (started || typeof window === 'undefined') return
  started = true

  if (GA4_ID && !window.gtag) {
    window.dataLayer = window.dataLayer || []
    window.gtag = function () { window.dataLayer.push(arguments) }
    window.gtag('js', new Date())
    window.gtag('config', GA4_ID, { anonymize_ip: true })
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`)
  }

  if (META_PIXEL_ID && !window.fbq) {
    const q = []
    const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments) }
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    fbq.queue = q
    window.fbq = window._fbq = fbq
    addScript('https://connect.facebook.net/en_US/fbevents.js')
    window.fbq('init', META_PIXEL_ID)
    window.fbq('track', 'PageView')
  }
}

/** @param {'hero'|'sticky'|'final'} placement which Play button was tapped */
export function trackDownloadClick(placement) {
  if (typeof window === 'undefined') return
  try {
    if (typeof window.gtag === 'function') window.gtag('event', 'download_click', { placement })
    if (typeof window.fbq === 'function') window.fbq('trackCustom', 'download_click', { placement })
  } catch { /* analytics must never block the link */ }
}
