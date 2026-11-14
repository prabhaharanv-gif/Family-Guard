/**
 * LandingPage
 *
 * The public website: what Kinest is, its main features, the privacy promise,
 * and the links Play requires (privacy policy, delete account). Shown at "/"
 * to signed-out visitors on the web only. In the Android app, and for anyone
 * signed in, "/" is still the app itself (see RootRoute in App.jsx).
 *
 * Built as swipeable slides rather than one long scroll: each section is a
 * full-screen slide and a right-to-left swipe moves to the next. The slides are
 * a native horizontal scroll-snap strip, so touch swiping, trackpads and
 * momentum come from the browser; the arrows, dots and arrow keys are for
 * everyone without a touchscreen, and a mouse drag is handled by hand because
 * scroll-snap alone does not respond to one.
 *
 * The app shell locks the document (html/body overflow hidden, no zoom), so
 * this page is its own fixed layer, the same approach PrivacyPolicyPage takes.
 *
 * The phone picture is drawn in CSS with no names or photos: a screenshot of
 * the real app would show real people's locations, and anything made up has to
 * be obviously just a picture.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import Icon from '../components/Icon'
import AuthLanguagePicker from '../components/AuthLanguagePicker'
import { PLAY_STORE_URL as PLAY_DEFAULT_URL, playStoreUrlFor, isAdVisit } from '../lib/siteConfig'
import AdLandingPage from './AdLandingPage'
import { CSS, PhoneGrid } from './landingShow'

const FEATURES = [
  { icon: 'map',     n: 1 },
  { icon: 'siren',   n: 'Sos' },
  { icon: 'pin',     n: 2 },
  { icon: 'message', n: 3 },
  { icon: 'phone',   n: 4 },
  { icon: 'radio',   n: 5 },
]

const WHY = [
  { icon: 'users', n: 1 },
  { icon: 'siren', n: 2 },
  { icon: 'heart', n: 3 },
]

const PRIVACY = [
  { icon: 'lock',   n: 1 },
  { icon: 'shield', n: 2 },
  { icon: 'clock',  n: 3 },
  { icon: 'trash',  n: 4 },
]

// The hero and the phone page (slides 0 and 1) are both maroon; after that the slides
// alternate white / maroon, so adding or removing a later one never breaks the rhythm. The bars drawn over a maroon slide
// go white (data-dark on the root).
const SLIDES = [
  { id: 'hero',     label: 'landing.heroTag' },
  { id: 'show',     label: 'landing.navShow' },
  { id: 'features', label: 'landing.navFeatures' },
  { id: 'sos',      label: 'landing.navSafety' },
  { id: 'privacy',  label: 'landing.navPrivacy' },
  { id: 'why',      label: 'landing.navWhy' },
  { id: 'start',    label: 'landing.navStart' },
]

const isDark = (i) => i === 0 || (i - 1) % 2 === 0


/**
 * HeroAura — a quiet, living network drawn behind the hero copy.
 *
 * Small glowing dots (the family) drift slowly and link to their neighbours with
 * hairlines, and every few seconds a faint ring spreads from the middle like a
 * heartbeat ("all is well"). It does not react to the mouse or to touch, and it is
 * deliberately low contrast (links at most about 22% white) so it never competes with the words.
 *
 * It only runs while the first slide is on screen and the tab is visible, caps the
 * pixel ratio at 2, and for people who ask for reduced motion it draws one still
 * frame and nothing moves.
 */
function HeroAura({ active }) {
  const ref = useRef(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d')
    if (!ctx) return undefined
    let reduce = false
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { /* keep false */ }

    const COLORS = ['255,255,255', '253,164,175', '110,231,183']
    let w = 0, h = 0, raf = 0, last = 0, nodes = []
    const t0 = performance.now()

    const resize = () => {
      const r = cv.getBoundingClientRect()
      if (!r.width || !r.height) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = r.width; h = r.height
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.max(14, Math.min(42, Math.round((w * h) / 34000)))
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16,
        r: 1.6 + Math.random() * 2.2, c: COLORS[i % 3 === 0 ? 1 : i % 5 === 0 ? 2 : 0], ph: Math.random() * 6.28,
      }))
    }

    const frame = (now) => {
      raf = 0
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
      last = now
      const t = (now - t0) / 1000
      ctx.clearRect(0, 0, w, h)

      if (!reduce) {
        for (const n of nodes) {
          n.x += n.vx * dt; n.y += n.vy * dt
          if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20
          if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20
        }
      }

      // neighbours link to each other
      const D = Math.min(190, Math.max(110, w / 9))
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
          const d2 = dx * dx + dy * dy
          if (d2 < D * D) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - Math.sqrt(d2) / D) * 0.22})`
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
          }
        }
      }

      // the dots themselves, each breathing a little
      for (const n of nodes) {
        const k = reduce ? 0.8 : 0.6 + 0.4 * Math.sin(t * 1.3 + n.ph)
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5)
        g.addColorStop(0, `rgba(${n.c},${0.3 * k})`); g.addColorStop(1, `rgba(${n.c},0)`)
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 5, 0, 6.2832); ctx.fill()
        ctx.fillStyle = `rgba(${n.c},${0.62 * k + 0.12})`; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832); ctx.fill()
      }

      if (!reduce) {
        // heartbeat: a faint ring from the middle every ~6.5 s, then a softer echo
        const cx = w / 2, cy = h * 0.46, maxR = Math.min(w, h) * 0.75
        for (const [off, a] of [[0.9, 0.14], [1.5, 0.08]]) {
          const p = (((t - off) % 6.5) + 6.5) % 6.5 / 3.2
          if (p < 1 && t > off) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * a})`; ctx.lineWidth = 1.5
            ctx.beginPath(); ctx.arc(cx, cy, p * maxR, 0, 6.2832); ctx.stroke()
          }
        }
        if (active && !document.hidden) raf = requestAnimationFrame(frame)
      }
    }

    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame) } }
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onVis = () => { if (document.hidden) stop(); else if (active && !reduce) start() }

    resize()
    if (reduce) { frame(performance.now()) }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    if (active && !reduce) start()
    return () => {
      stop()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [active])

  return <canvas ref={ref} className="kl-aura" aria-hidden="true" />
}

/** The four-colour Google Play triangle. */
function PlayGlyph() {
  return (
    <svg width="20" height="22" viewBox="0 0 24 26" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1.2 1.1C.9 1.4.8 1.8.8 2.3v21.4c0 .5.1.9.4 1.2L13 13z" fill="#00A0FF" />
      <path d="M1.2 1.1 13 13l4.1-4.1L3.6 1.3C2.7.8 1.8.6 1.2 1.1z" fill="#00E076" />
      <path d="M17.1 8.9 13 13l4.1 4.1 5.3-3c1.1-.6 1.1-1.6 0-2.2z" fill="#FFD500" />
      <path d="M1.2 24.9c.6.5 1.5.3 2.4-.2l13.5-7.6L13 13z" fill="#FF3A44" />
    </svg>
  )
}

function Cards({ items, prefix, t, two }) {
  return (
    <div className={`kl-grid${two ? ' two' : ''}`}>
      {items.map(f => (
        <div className="kl-card" key={f.n}>
          <div className="kl-ico"><Icon name={f.icon} size={21} /></div>
          <h3>{t(`landing.${prefix}${f.n}Title`)}</h3>
          <p>{t(`landing.${prefix}${f.n}Body`)}</p>
        </div>
      ))}
    </div>
  )
}

function SlidesLanding() {
  const t = useT()
  const slides = SLIDES
  const trackRef = useRef(null)
  const drag = useRef(null)
  const [idx, setIdx] = useState(0)
  const [dragging, setDragging] = useState(false)
  // The Swipe hint is for the first visit only. Once someone has moved off the
  // first slide it never comes back (best effort: storage can be blocked).
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem('kinest_swiped') === '1' } catch (e) { return false }
  })
  useEffect(() => {
    if (idx > 0 && !seen) {
      setSeen(true)
      try { localStorage.setItem('kinest_swiped', '1') } catch (e) {}
    }
  }, [idx, seen])

  // The document title is "Kinest" for the whole SPA; give the home page a
  // descriptive one for the browser tab and for search results, then put it
  // back so the app's own screens are not left with it.
  useEffect(() => {
    const prev = document.title
    document.title = `Kinest: ${t('landing.heroTitle')}`
    return () => { document.title = prev }
  }, [t.lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (i) => {
    const el = trackRef.current
    if (!el) return
    const n = Math.max(0, Math.min(slides.length - 1, i))
    el.scrollTo({ left: n * el.clientWidth })
  }

  const onScroll = () => {
    const el = trackRef.current
    if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / el.clientWidth))
  }

  // Resizing the window changes the slide width; keep the same slide in view.
  useEffect(() => {
    const onResize = () => {
      const el = trackRef.current
      if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: 'instant' })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [idx])

  const onKey = (e) => {
    if (e.target.closest?.('a, button, input')) {
      // let Enter/Space work on the focused control; arrows still page
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(idx + 1) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(idx - 1) }
  }

  // A mouse cannot swipe a scroll-snap strip, so a drag with one is translated
  // into scrolling. Touch and pen already work natively and are left alone.
  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if (e.target.closest('a, button')) return
    const el = trackRef.current
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 6) return
    const el = trackRef.current
    if (!d.moved) {
      d.moved = true
      setDragging(true)
      // Switch snapping off right now, not after React re-renders, or the
      // first moves of a drag are snapped straight back.
      el.classList.add("drag")
    }
    el.scrollTo({ left: d.left - dx, behavior: "instant" })
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    const el = trackRef.current
    setDragging(false)
    // Settle on the nearest slide, nudged by a short flick.
    const raw = el.scrollLeft / el.clientWidth
    const delta = raw - d.left / el.clientWidth
    const target = Math.abs(delta) > 0.12 ? (delta > 0 ? Math.ceil(raw) : Math.floor(raw)) : Math.round(raw)
    requestAnimationFrame(() => goTo(target))
  }

  // A link only once the real Play URL is set in lib/siteConfig.js; until then the
  // button is shown but is not a link.
  // Instagram/Facebook's in-app browser on Android often ignores a plain Play link.
  // There, hand the Play app an intent link, with the normal URL as the fallback.
  // Carry the visitor's utm_ campaign (from an ad link) through to Play as the install referrer.
  const PLAY_STORE_URL = PLAY_DEFAULT_URL && typeof window !== 'undefined' ? playStoreUrlFor(window.location.search) : PLAY_DEFAULT_URL
  const inApp = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && /Instagram|FBAN|FBAV|FB_IAB/i.test(navigator.userAgent)
  const playHref = PLAY_STORE_URL && inApp
    ? `intent://details?${PLAY_STORE_URL.split('?')[1]}#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
    : PLAY_STORE_URL
  const download = PLAY_STORE_URL
    ? <a className="kl-btn light" href={playHref} rel="noopener"><PlayGlyph />{t('landing.getApp')}</a>
    : <span className="kl-btn soon" aria-disabled="true"><PlayGlyph />{t('landing.getApp')}</span>

  const body = {
    hero: (
      <div className="kl-herogrid">
        <div className="kl-heroin">
          <h1 className="kl-hero-h">{t('landing.heroTitle')}</h1>
          <p className="kl-sub">{t('landing.heroSub')}</p>
          <div className="kl-cta">
            {download}
            <Link className="kl-btn ghost" to="/login">{t('landing.openWeb')}</Link>
          </div>
          {/* Instagram/Facebook open links in their own browser, which often will not hand off to the Play Store app. */}
          {PLAY_STORE_URL && /Instagram|FBAN|FBAV|FB_IAB/i.test(navigator.userAgent) && (
            <div className="kl-hint" style={{ marginTop: 10, maxWidth: 320 }}>{t('landing.inAppHint')}</div>
          )}
          {!seen && (
            <div className="kl-hint">
              {t('landing.swipeHint')}
              <span className="nudge"><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="arrowLeft" size={16} /></span></span>
            </div>
          )}
        </div>
      </div>
    ),
    show: <PhoneGrid running={idx === slides.findIndex(x => x.id === 'show')} t={t} />,
    features: (
      <>
        <h2 className="kl-h2">{t('landing.featuresTitle')}</h2>
        <Cards items={FEATURES} prefix="f" t={t} />
      </>
    ),
    sos: (
      <>
        <h2 className="kl-h2">{t('landing.sosTitle')}</h2>
        <p style={{ margin: '6px 0 0', opacity: .92, fontSize: 17 }}>{t('landing.sosSub')}</p>
        <ul>
          {[1, 2, 3, 4].map(n => (
            <li key={n}>
              <span className="kl-tick"><Icon name="checkCircle" size={16} /></span>
              <span>{t(`landing.sos${n}`)}</span>
            </li>
          ))}
        </ul>
        <p className="kl-warn">{t('landing.sosNote')}</p>
      </>
    ),
    start: (
      <>
        <h2 className="kl-h2">{t('landing.stepsTitle')}</h2>
        <div className="kl-steps">
          {[1, 2, 3].map(n => (
            <div className="kl-step" key={n}>
              <b>{n}</b>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{t(`landing.step${n}Title`)}</h3>
              <p style={{ margin: 0, color: '#5A3A47', fontSize: 14.5 }}>{t(`landing.step${n}Body`)}</p>
            </div>
          ))}
          {/* the fourth card is the way in: it goes to the registration page */}
          <Link className="kl-step kl-step-cta" to="/register">
            <b><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="arrowLeft" size={16} /></span></b>
            <h3>{t('landing.step4Title')}</h3>
            <p>{t('landing.step4Body')}</p>
          </Link>
        </div>
      </>
    ),
    privacy: (
      <>
        <h2 className="kl-h2">{t('landing.privacyTitle')}</h2>
        <Cards items={PRIVACY} prefix="p" t={t} two />
      </>
    ),
    why: (
      <>
        <h2 className="kl-h2">{t('landing.whyTitle')}</h2>
        <Cards items={WHY} prefix="why" t={t} />
      </>
    ),
  }

  return (
    <div className="kl" data-lang={t.lang} data-home={idx === 0} data-dark={isDark(idx)} tabIndex={-1} onKeyDown={onKey}>
      <style>{CSS}</style>

      <div
        ref={trackRef}
        className={`kl-track${dragging ? ' drag' : ''}`}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        role="region"
        aria-roledescription="carousel"
        aria-label="Kinest"
      >
        {slides.map((s, i) => (
          <section
            key={s.id}
            data-id={s.id}
            className={`kl-slide ${isDark(i) ? (s.id === 'sos' ? 'kl-s-sos' : 'kl-s-hero') : ''}${s.id === 'show' ? ' kl-s-show' : ''}${i === idx ? ' on' : ''}`}
            aria-label={t(s.label)}
            aria-hidden={i !== idx}
            inert={i !== idx}
          >
            {/* the watermark lives inside the clipped background layer so it cannot add scrollable overflow */}
            <div className="kl-bg" aria-hidden="true"><i /><i /><span className="kl-wm">{String(i + 1).padStart(2, '0')}</span>
              {s.id === 'hero' && <HeroAura active={idx === 0} />}
            </div>
            {/* the slide's title: a small pill under the Kinest logo, the same on every slide */}
            <div className="kl-showhead">
              <span className="kl-eyebrow">{t(s.label)}</span>
            </div>
            <div className="kl-in">
              {body[s.id]}
            </div>
          </section>
        ))}
      </div>

      <div className="kl-top">
        <a className="kl-brand" href="/"><img src="/kinest-icon.png" alt="" />Kinest</a>
        {/* the language picker, like the legal links, belongs to the home slide */}
        {idx === 0 && <div className="kl-langwrap"><AuthLanguagePicker /></div>}
      </div>

      <div className="kl-bot">
        {/* Privacy, Terms, Help, Contact and Delete Account are on the home slide only */}
        {idx === 0 && (
          <nav className="kl-legal" aria-label="Legal">
            <Link to="/privacy">{t('landing.footPrivacy')}</Link>
            <Link to="/terms">{t('landing.footTerms')}</Link>
            <Link to="/manual">{t('landing.footHelp')}</Link>
            <Link to="/contact">{t('landing.navContact')}</Link>
            <Link to="/delete-account">{t('landing.footDelete')}</Link>
          </nav>
        )}
        <div className="kl-nav">
          <span className="kl-count" aria-hidden="true">{String(idx + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
          <button className="kl-arrow" onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Previous">
            <Icon name="arrowLeft" size={18} />
          </button>
          <div className="kl-dots">
            {slides.map((s, i) => (
              <button key={s.id} className="kl-dotb" aria-current={i === idx} aria-label={t(s.label)} onClick={() => goTo(i)} />
            ))}
          </div>
          <button className="kl-arrow" onClick={() => goTo(idx + 1)} disabled={idx === slides.length - 1} aria-label="Next">
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="arrowLeft" size={18} /></span>
          </button>
        </div>
      </div>

      <div className="kl-prog" aria-hidden="true"><i style={{ width: `${((idx + 1) / slides.length) * 100}%` }} /></div>
    </div>
  )
}

/** Visitors from an ad get the single-scroll download page; everyone else the swipe slides. */
export default function LandingPage() {
  return isAdVisit(typeof window !== 'undefined' ? window.location.search : '') ? <AdLandingPage /> : <SlidesLanding />
}
