/**
 * AdLandingPage
 *
 * What someone sees when they reach kinest.co.in from an ad (the address carries
 * utm_ keys or Meta's fbclid; see isAdVisit in lib/siteConfig.js). Deliberately
 * tiny, one job: get them to install Kinest from Google Play. Top to bottom:
 * logo and name, a short emotional quote, swipeable real screenshots (the files
 * listed in AD_SHOTS, with arrows), then the Play button. Everyone else still
 * gets the swipe-slide LandingPage.
 *
 * Play button taps are counted as `download_click` (lib/tracking.js) when GA4 /
 * Meta Pixel IDs are configured, with no personal data.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import Icon from '../components/Icon'
import { PLAY_STORE_URL as PLAY_DEFAULT_URL, playStoreUrlFor, AD_SHOTS } from '../lib/siteConfig'
import { initTracking, trackDownloadClick } from '../lib/tracking'

const CSS = `
.ad { position: fixed; inset: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;
  background: linear-gradient(170deg, #8B0D3D 0%, #5A0A27 55%, #3A0418 100%); color: #fff;
  font-family: Inter, system-ui, sans-serif; line-height: 1.5; }
.ad * { box-sizing: border-box; }
.ad .ad-name { font-family: Sora, Inter, system-ui, sans-serif; }
.ad a { color: inherit; }
.ad-wrap { width: 100%; max-width: 480px; margin: 0 auto; padding: 0 20px; }

.ad-head { display: flex; align-items: center; justify-content: center; gap: 10px; padding: max(14px, env(safe-area-inset-top)) 0 0; }
.ad-logo { width: 44px; height: 44px; border-radius: 12px; display: block; }
.ad-name { margin: 0; font-size: 24px; font-weight: 900; letter-spacing: .01em; }

/* the quote: one big line, one soft line under it */
.ad-quote { margin: 10px auto 0; max-width: 330px; text-align: center; }
.ad-quote .q { margin: 0; font: 900 26px/1.25 Sora, Inter, sans-serif; text-wrap: balance; }
.ad-quote .s { margin: 6px 0 0; font-size: 14.5px; font-weight: 500; line-height: 1.5; color: #F7CFDC; text-wrap: balance; }
.ad[data-lang="ta"] .ad-quote .q, .ad[data-lang="ml"] .ad-quote .q, .ad[data-lang="te"] .ad-quote .q,
.ad[data-lang="kn"] .ad-quote .q, .ad[data-lang="hi"] .ad-quote .q { font-size: 22px; line-height: 1.4; }
.ad[data-lang="ta"] .ad-quote .s, .ad[data-lang="ml"] .ad-quote .s, .ad[data-lang="te"] .ad-quote .s,
.ad[data-lang="kn"] .ad-quote .s, .ad[data-lang="hi"] .ad-quote .s { font-size: 13.5px; line-height: 1.6; }

/* one screenshot on screen at a time; the arrows sit just outside it */
.ad-carousel { position: relative; width: var(--w); margin: 10px auto 0;
  /* the picture takes whatever height is left once the text and button are placed, so the button stays on screen even inside a browser's toolbars; dvh overrides vh where supported */
  --w: max(120px, min(68vw, 256px, calc((100vh - 300px) / 1.6))); }
@supports (height: 100dvh) { .ad-carousel { --w: max(120px, min(68vw, 256px, calc((100dvh - 300px) / 1.6))); } }
.ad-shots { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
.ad-shots::-webkit-scrollbar { display: none; }
.ad-slide { flex: 0 0 100%; margin: 0; scroll-snap-align: center; scroll-snap-stop: always; }
.ad-shot { border-radius: 26px; padding: 5px; background: #1E0510; }
.ad-slide figcaption { margin-top: 6px; text-align: center; font-size: 13px; font-weight: 700; color: #F7CFDC; }
.ad-shot img { display: block; width: 100%; height: auto; aspect-ratio: 992 / 1585; object-fit: cover; border-radius: 21px; }
.ad .ad-arrow { position: absolute; top: calc(50% - 20px); transform: translateY(-50%); width: 42px; height: 42px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; background: rgba(255,255,255,.92); color: #8B0D3D; box-shadow: 0 6px 16px rgba(0,0,0,.35);
  -webkit-tap-highlight-color: transparent; }
.ad .ad-arrow.prev { left: -52px; } .ad .ad-arrow.next { right: -52px; }
.ad .ad-arrow:disabled { opacity: .3; cursor: default; }
.ad .ad-arrow:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

.ad-cta { margin: 8px 0 0; text-align: center; }
.ad .ad-play { display: inline-flex; align-items: center; justify-content: center; gap: 12px; width: 100%; max-width: 340px; min-height: 54px;
  padding: 14px 24px; border-radius: 16px; background: #fff; color: #8B0D3D; font: 800 18px Inter, sans-serif; text-decoration: none;
  box-shadow: 0 10px 26px rgba(0,0,0,.3); transition: transform .2s; -webkit-tap-highlight-color: transparent; }
.ad .ad-play:active { transform: scale(.98); }
.ad .ad-play:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.ad-free { margin: 8px 0 0; font-size: 13px; font-weight: 600; color: #F7CFDC; }
.ad-hint { margin: 12px auto 0; max-width: 300px; font-size: 13px; opacity: .85; }

.ad-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 20px; margin: 26px 0 0;
  padding: 0 20px max(24px, env(safe-area-inset-bottom)); font-size: 13px; opacity: .8; }
.ad-foot a { text-decoration: none; padding: 8px 2px; }

@media (prefers-reduced-motion: reduce) { .ad .ad-play { transition: none; } .ad-shots { scroll-behavior: auto; } }
`

function PlayGlyph() {
  return (
    <svg width="22" height="24" viewBox="0 0 24 26" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1.2 1.1C.9 1.4.8 1.8.8 2.3v21.4c0 .5.1.9.4 1.2L13 13z" fill="#00A0FF" />
      <path d="M1.2 1.1 13 13l4.1-4.1L3.6 1.3C2.7.8 1.8.6 1.2 1.1z" fill="#00E076" />
      <path d="M17.1 8.9 13 13l4.1 4.1 5.3-3c1.1-.6 1.1-1.6 0-2.2z" fill="#FFD500" />
      <path d="M1.2 24.9c.6.5 1.5.3 2.4-.2l13.5-7.6L13 13z" fill="#FF3A44" />
    </svg>
  )
}

export default function AdLandingPage() {
  const t = useT()
  const track = useRef(null)
  const pending = useRef(null)   // the slot an arrow tap is heading to, until the scroll settles
  const settle = useRef(0)
  const [edge, setEdge] = useState({ start: true, end: false })
  useEffect(() => { initTracking() }, [])

  const syncEdges = useCallback(() => {
    const el = track.current
    if (!el) return
    clearTimeout(settle.current)
    settle.current = setTimeout(() => { pending.current = null }, 160)
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 4 })
  }, [])
  useEffect(() => {
    syncEdges()
    window.addEventListener('resize', syncEdges)
    return () => window.removeEventListener('resize', syncEdges)
  }, [syncEdges])

  // One arrow tap moves by exactly one screenshot.
  const step = (dir) => {
    const el = track.current
    const first = el && el.querySelector('.ad-slide')
    if (!first) return
    // Aim at an absolute slot, not a relative nudge, so a quick second tap cannot land between two shots.
    const w = first.offsetWidth
    const now = Math.round(el.scrollLeft / w)
    const target = Math.min(AD_SHOTS.length - 1, Math.max(0, (pending.current ?? now) + dir))
    pending.current = target
    el.scrollTo({ left: target * w, behavior: 'smooth' })
  }

  const url = PLAY_DEFAULT_URL && typeof window !== 'undefined' ? playStoreUrlFor(window.location.search) : PLAY_DEFAULT_URL
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const inApp = /Instagram|FBAN|FBAV|FB_IAB/i.test(ua)
  // Instagram/Facebook's in-app browser on Android often ignores a plain Play link, so hand the Play app an intent link.
  const href = url && inApp && /Android/i.test(ua)
    ? `intent://details?${url.split('?')[1]}#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(url)};end`
    : url

  return (
    <div className="ad" data-lang={t.lang}>
      <style>{CSS}</style>

      <div className="ad-wrap">
        <div className="ad-head">
          <img className="ad-logo" src="/kinest-icon.png" alt="" width="44" height="44" />
          <div className="ad-name">Kinest</div>
        </div>
        <blockquote className="ad-quote">
          <p className="q">{t('landing.adQuote')}</p>
          <p className="s">{t('landing.adQuoteSub')}</p>
        </blockquote>
      </div>

      {AD_SHOTS.length > 0 && (
        <div className="ad-carousel" role="group" aria-roledescription="carousel" aria-label={t('landing.navShow')}>
          <div className="ad-shots" ref={track} onScroll={syncEdges}>
            {AD_SHOTS.map((s, i) => (
              <figure className="ad-slide" key={s.src}>
                <div className="ad-shot">
                  <img src={s.src} alt={s.alt || ''} width="992" height="1585" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />
                </div>
                {s.cap && <figcaption>{t(s.cap)}</figcaption>}
              </figure>
            ))}
          </div>
          <button type="button" className="ad-arrow prev" onClick={() => step(-1)} disabled={edge.start} aria-label="Previous">
            <Icon name="arrowLeft" size={20} />
          </button>
          <button type="button" className="ad-arrow next" onClick={() => step(1)} disabled={edge.end} aria-label="Next">
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="arrowLeft" size={20} /></span>
          </button>
        </div>
      )}

      <div className="ad-wrap">
        <div className="ad-cta">
          {url
            ? <a className="ad-play" href={href} rel="noopener" onClick={() => trackDownloadClick('hero')}><PlayGlyph />{t('landing.getApp')}</a>
            : <span className="ad-play" aria-disabled="true"><PlayGlyph />{t('landing.getApp')}</span>}
          <p className="ad-free">{t('landing.adFree')}</p>
          {url && inApp && <p className="ad-hint">{t('landing.inAppHint')}</p>}
        </div>
      </div>

      <footer className="ad-foot">
        <Link to="/privacy">{t('landing.footPrivacy')}</Link>
        <Link to="/terms">{t('landing.footTerms')}</Link>
      </footer>
    </div>
  )
}
