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
import { PLAY_STORE_URL } from '../lib/siteConfig'

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

const CSS = `
.kl { position: fixed; inset: 0; background: #FFFBFC; color: #2A0A16; outline: none;
  font-family: Inter, system-ui, sans-serif; line-height: 1.55; }
.kl * { box-sizing: border-box; }
.kl h1, .kl h2, .kl h3 { font-family: Sora, Inter, system-ui, sans-serif; margin: 0; line-height: 1.2; }
.kl a { color: inherit; }

.kl-track { position: absolute; inset: 0; display: flex; overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.kl-track::-webkit-scrollbar { display: none; }
.kl-track.drag { scroll-snap-type: none; cursor: grabbing; user-select: none; }
@media (prefers-reduced-motion: no-preference) { .kl-track { scroll-behavior: smooth; } .kl-track.drag { scroll-behavior: auto; } }

.kl-slide { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always;
  overflow-y: auto; padding: 120px 28px 108px; display: flex; position: relative; }
.kl-in { margin: auto; width: 100%; max-width: 980px; position: relative; z-index: 1; }
.kl-s-hero { background: linear-gradient(150deg, #8B0D3D 0%, #48061F 100%); color: #fff; }
.kl-s-sos { background: linear-gradient(150deg, #B01650 0%, #6E0A30 100%); color: #fff; }

/* ── bars drawn over the slides ── */
.kl-top, .kl-bot { position: absolute; left: 0; right: 0; z-index: 5; display: flex; align-items: center;
  justify-content: space-between; padding: 18px 24px; gap: 14px; color: #6E0A30; pointer-events: none; transition: color .25s; }
.kl-top { top: 0; } .kl-bot { bottom: 0; padding-bottom: 20px; }
.kl[data-dark="true"] .kl-top, .kl[data-dark="true"] .kl-bot { color: #fff; }
.kl-top > *, .kl-bot > * { pointer-events: auto; }
.kl-brand { display: inline-flex; align-items: center; gap: 10px; font: 900 21px Sora, sans-serif; text-decoration: none; }
.kl-brand img { width: 38px; height: 38px; border-radius: 10px; }
.kl-langwrap { position: relative; width: 150px; height: 40px; }
.kl-legal { display: flex; flex-wrap: wrap; gap: 8px 10px; font-size: 13px; }
.kl-legal a { display: inline-flex; align-items: center; padding: 8px 16px; border-radius: 999px; font-weight: 700; text-decoration: none;
  border: 1.5px solid currentColor; background: rgba(139,13,61,.06); transition: background .2s, transform .2s; }
.kl-legal a:hover { background: rgba(139,13,61,.14); transform: translateY(-1px); }
.kl[data-dark="true"] .kl-legal a { background: rgba(255,255,255,.08); }
.kl[data-dark="true"] .kl-legal a:hover { background: rgba(255,255,255,.2); }
.kl-legal a:focus-visible { outline: 3px solid #E11D48; outline-offset: 2px; }
.kl-nav { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.kl-dots { display: flex; gap: 8px; }
.kl-dotb { width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 0; cursor: pointer; background: currentColor; color: inherit; opacity: .35;
  transition: opacity .2s, width .2s; }
.kl-dotb[aria-current="true"] { opacity: 1; width: 26px; border-radius: 6px; }
.kl-arrow { width: 40px; height: 40px; border-radius: 50%; border: 1.5px solid currentColor; background: transparent; color: inherit;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; opacity: .85; }
.kl-arrow:hover:not(:disabled) { opacity: 1; background: rgba(139,13,61,.1); }
.kl[data-dark="true"] .kl-arrow:hover:not(:disabled) { background: rgba(255,255,255,.16); }
.kl-arrow:disabled { opacity: .25; cursor: default; }
.kl-arrow:focus-visible, .kl-dotb:focus-visible, .kl-btn:focus-visible { outline: 3px solid #E11D48; outline-offset: 2px; }

/* ── content ── */
.kl-herogrid { display: grid; grid-template-columns: minmax(0, 760px); justify-content: center; align-items: start; height: clamp(470px, calc(100vh - 262px), 640px); }
.kl-heroin { text-align: center; }
.kl-heroin .kl-sub { margin-left: auto; margin-right: auto; }
.kl-heroin .kl-cta { justify-content: center; }
.kl-heroin .kl-hint { justify-content: center; }
.kl-s-show { background: linear-gradient(210deg, #8B0D3D 0%, #3A0418 100%); }
.kl-slide[data-id="show"] .kl-in { text-align: center; }
.kl .kl-hero-h { font-size: clamp(28px, 4.3vw, 50px); line-height: 1.16; font-weight: 900; margin: 20px 0 16px; text-wrap: balance; }
.kl-aura { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 0; }
@supports (background-clip: text) or (-webkit-background-clip: text) {
  @media (prefers-reduced-motion: no-preference) {
    /* a single soft light sweep across the headline, once, a moment after the page opens */
    .kl .kl-hero-h { background: linear-gradient(105deg, #fff 0%, #fff 42%, #FFD1E1 50%, #fff 58%, #fff 100%); background-size: 250% 100%;
      background-position: 0% 0; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
  }
}
@keyframes klShine { from { background-position: 0% 0; } to { background-position: 100% 0; } }
/* Indic scripts are wider and taller per word; a slightly smaller heading keeps every language to about the same height */
.kl[data-lang="ta"] .kl-hero-h, .kl[data-lang="ml"] .kl-hero-h, .kl[data-lang="te"] .kl-hero-h,
.kl[data-lang="kn"] .kl-hero-h, .kl[data-lang="hi"] .kl-hero-h { font-size: clamp(22px, 2.9vw, 35px); line-height: 1.32; }
.kl[data-lang="ta"] .kl-sub, .kl[data-lang="ml"] .kl-sub, .kl[data-lang="te"] .kl-sub,
.kl[data-lang="kn"] .kl-sub, .kl[data-lang="hi"] .kl-sub { font-size: clamp(14px, 1.3vw, 16.5px); line-height: 1.7; }
.kl-sub { font-size: clamp(15px, 1.5vw, 18px); line-height: 1.65; opacity: .94; max-width: 520px; margin: 0 0 30px; text-wrap: pretty; }
/* Always stacked and equal width, so a longer label in another language never reflows the hero */
.kl-cta { display: grid; grid-template-columns: max-content; gap: 12px; justify-items: stretch; }
.kl-cta .kl-btn { justify-content: center; }
.kl-btn { display: inline-flex; align-items: center; gap: 10px; padding: 15px 26px; border-radius: 16px; font-family: inherit; font-size: 15.5px; font-weight: 800;
  letter-spacing: .005em; text-decoration: none; border: 0; cursor: pointer; transition: transform .2s, box-shadow .2s, background .2s; }
.kl-btn.light { background: #fff; color: #8B0D3D; box-shadow: 0 10px 28px rgba(0,0,0,.28); }
.kl-btn.light:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(0,0,0,.34); }
.kl-btn.soon { background: #fff; color: #8B0D3D; cursor: default; box-shadow: 0 10px 28px rgba(0,0,0,.28); }
.kl-btn.ghost { background: rgba(255,255,255,.06); color: #fff; border: 1.5px solid rgba(255,255,255,.55); }
.kl-btn.ghost:hover { background: rgba(255,255,255,.16); transform: translateY(-2px); }

.kl-eyebrow { display: inline-block; margin-bottom: 12px; padding: 8px 20px; border-radius: 999px; background: #8B0D3D; color: #fff;
  font: 900 clamp(20px, 2.4vw, 28px) Sora, Inter, sans-serif; line-height: 1.2; }
.kl-s-hero .kl-eyebrow, .kl-s-sos .kl-eyebrow { background: #fff; color: #8B0D3D; }
.kl-h2 { font-size: clamp(18px, 2.2vw, 26px); font-weight: 900; color: #6E0A30; margin-bottom: 8px; }
.kl-lead { color: #6B4553; margin: 0 0 22px; font-size: 16px; max-width: 560px; }
.kl-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 820px; }
.kl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin-top: 20px; }
.kl-card { background: rgba(255,255,255,.78); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1.5px solid rgba(240,213,223,.9); border-radius: 16px; padding: 18px; box-shadow: 0 8px 28px rgba(139,13,61,.08); }
.kl-ico { width: 40px; height: 40px; border-radius: 11px; display: flex; align-items: center; justify-content: center;
  background: #FAE8EF; color: #8B0D3D; margin-bottom: 10px; }
.kl-card h3 { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
.kl-card p { margin: 0; color: #5A3A47; font-size: 14px; }

.kl-s-hero .kl-h2, .kl-s-sos .kl-h2 { color: #fff; }
.kl-s-hero .kl-lead, .kl-s-sos .kl-lead { color: rgba(255,255,255,.9); }
.kl-s-sos ul { list-style: none; padding: 22px 24px; margin: 22px 0 0; display: grid; gap: 14px; max-width: 640px;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.24); border-radius: 20px;
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.kl-s-sos li { display: flex; gap: 12px; align-items: flex-start; font-size: 16px; }
.kl-tick { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,.2);
  display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.kl-warn { margin: 24px 0 0; font-size: 13.5px; opacity: .88; max-width: 640px; }

.kl-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 20px; }
@media (max-width: 999px) { .kl-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .kl-steps { grid-template-columns: 1fr; } }
.kl-step.kl-step-cta { display: block; text-decoration: none; color: inherit; border: 2px solid #8B0D3D; transition: transform .2s, box-shadow .2s; }
.kl-step.kl-step-cta:hover { transform: translateY(-3px); box-shadow: 0 14px 34px rgba(139,13,61,.22); }
.kl-step.kl-step-cta:focus-visible { outline: 3px solid #E11D48; outline-offset: 3px; }
.kl-step.kl-step-cta h3 { font-size: 17px; font-weight: 800; margin-bottom: 4px; }
.kl-step.kl-step-cta p { margin: 0; font-size: 14.5px; color: #5A3A47; }
.kl-step { background: rgba(255,255,255,.78); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1.5px solid rgba(240,213,223,.9); border-radius: 16px; padding: 20px; box-shadow: 0 8px 28px rgba(139,13,61,.08); }
.kl-step b { display: inline-flex; width: 34px; height: 34px; border-radius: 50%; background: #8B0D3D; color: #fff;
  align-items: center; justify-content: center; font: 800 15px Sora, sans-serif; margin-bottom: 10px; }

.kl-phone { justify-self: center; width: 210px; border-radius: 32px; padding: 9px; background: #1A0510; box-shadow: 0 22px 50px rgba(0,0,0,.4); }
.kl-screen { position: relative; border-radius: 24px; overflow: hidden; background: #FDF0F5; color: #2A0A16; }
.kl-mapart { height: 140px; position: relative;
  background: radial-gradient(circle at 30% 40%, #F7D6E3 0 18%, transparent 19%),
              radial-gradient(circle at 72% 62%, #F3C6D8 0 14%, transparent 15%),
              linear-gradient(135deg, #FBE6EE, #F1CBDA); }
.kl-dot { position: absolute; width: 20px; height: 20px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(139,13,61,.35); }
.kl-row { display: flex; align-items: center; gap: 9px; padding: 8px 10px; margin: 7px; background: #fff; border-radius: 12px; box-shadow: 0 1px 6px rgba(139,13,61,.1); }
.kl-av { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; }
.kl-bar { height: 6px; border-radius: 4px; background: #E9C9D5; }


/* cards on a maroon slide stay solid white so the text keeps its contrast */
.kl-s-hero .kl-card, .kl-s-hero .kl-step, .kl-s-sos .kl-card, .kl-s-sos .kl-step { background: #fff; color: #2A0A16; box-shadow: 0 10px 30px rgba(0,0,0,.18); }

/* ── premium layer: backgrounds, watermark, motion ── */
.kl-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.kl-bg i { position: absolute; border-radius: 50%; filter: blur(70px); will-change: transform; }
.kl-bg i:nth-child(1) { width: 440px; height: 440px; top: -120px; right: -100px; }
.kl-bg i:nth-child(2) { width: 380px; height: 380px; bottom: -140px; left: -110px; }
.kl-s-hero .kl-bg i:nth-child(1) { background: rgba(225,29,72,.42); }
.kl-s-hero .kl-bg i:nth-child(2) { background: rgba(255,255,255,.1); }
.kl-s-sos .kl-bg i:nth-child(1) { background: rgba(255,255,255,.16); }
.kl-s-sos .kl-bg i:nth-child(2) { background: rgba(72,6,31,.5); }
.kl-slide:not(.kl-s-hero):not(.kl-s-sos) .kl-bg i:nth-child(1) { background: rgba(176,22,80,.12); }
.kl-slide:not(.kl-s-hero):not(.kl-s-sos) .kl-bg i:nth-child(2) { background: rgba(225,29,72,.08); }
.kl-wm { position: absolute; right: 3%; bottom: 3%; z-index: 0; font: 900 clamp(120px, 22vw, 320px)/1 Sora, sans-serif;
  color: #8B0D3D; opacity: .07; pointer-events: none; user-select: none; }
.kl-s-hero .kl-wm, .kl-s-sos .kl-wm { color: #fff; opacity: .08; }

.kl-hint { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; font-size: 13px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; opacity: .85; }

.kl-count { font: 800 13px Sora, sans-serif; letter-spacing: .08em; opacity: .9; min-width: 58px; text-align: right; font-variant-numeric: tabular-nums; }
.kl-prog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; z-index: 6; background: rgba(139,13,61,.12); pointer-events: none; }
.kl-prog i { display: block; height: 100%; background: #E11D48; transition: width .4s ease, background .25s; }
.kl[data-dark="true"] .kl-prog { background: rgba(255,255,255,.18); }
.kl[data-dark="true"] .kl-prog i { background: #fff; }

.kl-dot::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; background: inherit; opacity: 0; }

@keyframes klUp { from { opacity: .15; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes klPulse { 0% { transform: scale(.7); opacity: .65; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes klFloat { 0%, 100% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(28px, -22px, 0); } }
@keyframes klNudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(8px); } }
@media (prefers-reduced-motion: no-preference) {
  .kl-slide.on .kl-eyebrow, .kl-slide.on .kl-hero-h, .kl-slide.on .kl-h2, .kl-slide.on .kl-sub,
  .kl-slide.on .kl-cta, .kl-slide.on .kl-hint, .kl-slide.on .kl-phone,
  .kl-slide.on .kl-card, .kl-slide.on .kl-step, .kl-slide.on .kl-s-sos li, .kl-slide.on .kl-warn,
  .kl-slide.on .kl-in > p { animation: klUp .65s cubic-bezier(.2,.7,.2,1) both; }
  .kl-slide.on .kl-h2, .kl-slide.on .kl-hero-h { animation-delay: .08s; }
  .kl-slide.on .kl-sub { animation-delay: .16s; } .kl-slide.on .kl-cta { animation-delay: .32s; }

  .kl-slide.on .kl-hint { animation-delay: .48s; }
  .kl-slide.on .kl-warn { animation-delay: .6s; }
  .kl-slide.on .kl-hero-h { animation: klUp .65s cubic-bezier(.2,.7,.2,1) .08s both, klShine 2.2s ease-out 1.2s 1 both; }
  .kl-slide.on .kl-card:nth-child(1), .kl-slide.on .kl-step:nth-child(1), .kl-slide.on .kl-s-sos li:nth-child(1) { animation-delay: 0.23s; }
  .kl-slide.on .kl-card:nth-child(2), .kl-slide.on .kl-step:nth-child(2), .kl-slide.on .kl-s-sos li:nth-child(2) { animation-delay: 0.30s; }
  .kl-slide.on .kl-card:nth-child(3), .kl-slide.on .kl-step:nth-child(3), .kl-slide.on .kl-s-sos li:nth-child(3) { animation-delay: 0.37s; }
  .kl-slide.on .kl-card:nth-child(4), .kl-slide.on .kl-step:nth-child(4), .kl-slide.on .kl-s-sos li:nth-child(4) { animation-delay: 0.44s; }
  .kl-slide.on .kl-card:nth-child(5), .kl-slide.on .kl-step:nth-child(5), .kl-slide.on .kl-s-sos li:nth-child(5) { animation-delay: 0.51s; }
  .kl-slide.on .kl-card:nth-child(6), .kl-slide.on .kl-step:nth-child(6), .kl-slide.on .kl-s-sos li:nth-child(6) { animation-delay: 0.58s; }
  .kl-slide.on .kl-bg i { animation: klFloat 14s ease-in-out infinite; }
  .kl-slide.on .kl-bg i:nth-child(2) { animation-duration: 18s; animation-direction: reverse; }
  .kl-slide.on .kl-dot::after { animation: klPulse 2.4s ease-out infinite; }
  .kl-slide.on .kl-dot:nth-child(2)::after { animation-delay: .8s; } .kl-slide.on .kl-dot:nth-child(3)::after { animation-delay: 1.6s; }
  .kl-hint .nudge { display: inline-flex; animation: klNudge 1.4s ease-in-out infinite; }
}


.kl-stage { position: relative; height: 330px; perspective: 1000px; }
.kl-sc { position: absolute; inset: 0; overflow: hidden; pointer-events: none; backface-visibility: hidden;
  transform: rotateY(-100deg) scale(.9); opacity: 0;
  transition: transform .8s cubic-bezier(.2,.8,.2,1), opacity .45s ease; }
.kl-sc.cur { transform: none; opacity: 1; }
.kl-sc.prev { transform: rotateY(100deg) scale(.9); opacity: 0; }

.sc-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.75); opacity: 0; }
.sc-bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,.42); }
.sc-avs { display: flex; gap: 10px; }
.sc-av { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff;
  border: 2px solid rgba(255,255,255,.85); }

.sc-sos { background: linear-gradient(160deg, #E11D48, #8B0D3D); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 24px; }
.sc-sosC { position: relative; width: 104px; height: 104px; display: flex; align-items: center; justify-content: center; }
.sc-sosBtn { position: relative; width: 84px; height: 84px; border-radius: 50%; background: #fff; color: #E11D48;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 28px rgba(0,0,0,.32); }

.sc-call { background: linear-gradient(170deg, #6E0A30, #2A0A16); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 9px; }
.sc-callAv { position: relative; width: 74px; height: 74px; border-radius: 50%; background: rgba(255,255,255,.18);
  display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
.sc-callBtns { display: flex; gap: 14px; margin-top: 24px; }
.sc-callBtns span { width: 42px; height: 42px; border-radius: 50%; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; }
.sc-callBtns .end { background: #E11D48; }

.sc-chat { background: #FDF0F5; padding: 12px; display: flex; flex-direction: column; gap: 9px; }
.sc-head { height: 30px; flex-shrink: 0; border-radius: 10px; background: #fff; box-shadow: 0 1px 6px rgba(139,13,61,.1); margin-bottom: 4px; }
.sc-b { max-width: 74%; padding: 9px 11px; border-radius: 14px; display: grid; gap: 5px; }
.sc-b i { display: block; height: 6px; border-radius: 3px; background: #E9C9D5; }
.sc-b.in { background: #fff; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 6px rgba(139,13,61,.1); }
.sc-b.out { background: #8B0D3D; align-self: flex-end; border-bottom-right-radius: 4px; }
.sc-b.out i { background: rgba(255,255,255,.6); }
.sc-typing { align-self: flex-start; display: flex; gap: 4px; background: #fff; padding: 9px 12px; border-radius: 14px; box-shadow: 0 1px 6px rgba(139,13,61,.1); }
.sc-typing s { width: 6px; height: 6px; border-radius: 50%; background: #B01650; }

.sc-arr { background: #FBE6EE; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.sc-geo { position: relative; width: 150px; height: 150px; margin-bottom: 40px; border-radius: 50%; border: 2px dashed #B01650;
  background: rgba(176,22,80,.1); display: flex; align-items: center; justify-content: center; }
.sc-pin { width: 46px; height: 46px; border-radius: 50%; background: #8B0D3D; color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(139,13,61,.4); }
.sc-notif { position: absolute; left: 10px; right: 10px; bottom: 12px; display: flex; align-items: center; gap: 10px; padding: 10px;
  background: #fff; border-radius: 14px; box-shadow: 0 8px 24px rgba(139,13,61,.18); color: #10B981; }
.sc-nico { width: 30px; height: 30px; border-radius: 9px; background: #FAE8EF; color: #8B0D3D; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sc-notif .sc-nbars { flex: 1; display: grid; gap: 5px; }
.sc-notif .sc-nbars i { display: block; height: 6px; border-radius: 3px; background: #E9C9D5; }

.sc-off { background: linear-gradient(170deg, #2A0A16, #48061F); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px; }
.sc-nonet { position: relative; width: 64px; height: 64px; border-radius: 50%; background: rgba(255,255,255,.12); display: flex; align-items: center; justify-content: center; }
.sc-nonet::after { content: ''; position: absolute; width: 80px; height: 3px; border-radius: 2px; background: #E11D48; transform: rotate(-45deg); }
.sc-sms { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fff; color: #8B0D3D; border-radius: 14px; }
.sc-sms b { font: 800 11px Inter, sans-serif; padding: 3px 7px; background: #8B0D3D; color: #fff; border-radius: 6px; }
.sc-sms .sc-nbars { display: grid; gap: 5px; width: 60px; }
.sc-sms .sc-nbars i { display: block; height: 6px; border-radius: 3px; background: #E9C9D5; }

@keyframes klRing { 0% { transform: scale(.8); opacity: .8; } 100% { transform: scale(2.1); opacity: 0; } }
@keyframes klTyping { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
@media (prefers-reduced-motion: no-preference) {
  .kl-cap { animation: klUp .5s cubic-bezier(.2,.7,.2,1) both; }
  .kl-sc.cur .sc-ring { animation: klRing 1.8s ease-out infinite; }
  .kl-sc.cur .sc-ring + .sc-ring { animation-delay: .6s; }
  .kl-sc.cur .sc-b { animation: klUp .5s both; }
  .kl-sc.cur .sc-b:nth-child(2) { animation-delay: .25s; } .kl-sc.cur .sc-b:nth-child(3) { animation-delay: .6s; }
  .kl-sc.cur .sc-b:nth-child(4) { animation-delay: .95s; } .kl-sc.cur .sc-b:nth-child(5) { animation-delay: 1.3s; }
  .kl-sc.cur .sc-typing { animation: klUp .5s 1.65s both; }
  .kl-sc.cur .sc-typing s { animation: klTyping 1s ease-in-out infinite; }
  .kl-sc.cur .sc-typing s:nth-child(2) { animation-delay: .15s; } .kl-sc.cur .sc-typing s:nth-child(3) { animation-delay: .3s; }
  .kl-sc.cur .sc-notif { animation: klUp .6s .4s both; }
  .kl-sc.cur .sc-sms { animation: klUp .6s .3s both; }
  .kl-sc.cur .sc-geo { animation: klGeo 2.4s ease-in-out infinite; }
}
@keyframes klGeo { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }

/* more showcase screens */
.sc-nbars { display: grid; gap: 5px; }
.sc-nbars i { display: block; height: 6px; border-radius: 3px; background: #E9C9D5; }

.sc-tl { background: linear-gradient(135deg, #FBE6EE, #F1CBDA); }
.sc-slider { position: absolute; left: 10px; right: 10px; bottom: 12px; padding: 12px; background: #fff; border-radius: 14px; box-shadow: 0 8px 24px rgba(139,13,61,.16); }
.sc-trk { position: relative; height: 6px; border-radius: 3px; background: #E9C9D5; }
.sc-thumb { position: absolute; top: 50%; left: 0; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: #8B0D3D;
  border: 3px solid #fff; box-shadow: 0 2px 8px rgba(139,13,61,.4); }
.sc-tbars { display: flex; gap: 8px; margin-top: 10px; }
.sc-tbars i { display: block; width: 28px; height: 6px; border-radius: 3px; background: #E9C9D5; }

.sc-st { background: #FDF0F5; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.sc-stTop { display: flex; align-items: center; gap: 10px; padding: 10px; background: #fff; border-radius: 14px; box-shadow: 0 1px 6px rgba(139,13,61,.1); }
.sc-stTop .sc-nbars { flex: 1; }
.sc-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.sc-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px 4px; min-width: 0; min-height: 92px;
  background: #fff; border-radius: 14px; box-shadow: 0 1px 6px rgba(139,13,61,.1); }
.sc-tile.wide { flex-direction: row; gap: 10px; padding: 12px; min-height: 0; }
.sc-tile > i { display: block; width: 28px; height: 5px; border-radius: 3px; background: #E9C9D5; }
.sc-batt { position: relative; width: 34px; height: 20px; padding: 2px; border: 3px solid #8B0D3D; border-radius: 6px; }
.sc-batt::after { content: ''; position: absolute; right: -7px; top: 3px; width: 4px; height: 8px; border-radius: 0 2px 2px 0; background: #8B0D3D; }
.sc-batt b { display: block; width: 78%; height: 100%; border-radius: 2px; background: #10B981; }
.sc-sig { display: flex; align-items: flex-end; gap: 3px; height: 22px; }
.sc-sig s { width: 6px; border-radius: 2px; background: #8B0D3D; }
.sc-sig s:nth-child(1) { height: 6px; } .sc-sig s:nth-child(2) { height: 11px; } .sc-sig s:nth-child(3) { height: 16px; } .sc-sig s:nth-child(4) { height: 22px; opacity: .3; }

.sc-voice { background: linear-gradient(170deg, #B01650, #48061F); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 22px; }
.sc-mic { position: relative; width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center; }
.sc-wave { display: flex; align-items: center; gap: 5px; height: 40px; }
.sc-wave s { width: 5px; height: 100%; border-radius: 3px; background: #fff; transform: scaleY(.3); }
.sc-wave s:nth-child(2n) { background: rgba(255,255,255,.7); }
.sc-photo { width: 64px; height: 50px; border-radius: 12px; background: rgba(255,255,255,.22); border: 1.5px solid rgba(255,255,255,.55);
  display: flex; align-items: center; justify-content: center; }

.sc-near { background: linear-gradient(170deg, #2A0A16, #48061F); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 22px; }
.sc-radar { position: relative; width: 168px; height: 168px; border-radius: 50%; border: 2px solid rgba(255,255,255,.28);
  box-shadow: inset 0 0 0 28px rgba(255,255,255,.04), inset 0 0 0 29px rgba(255,255,255,.14), inset 0 0 0 56px rgba(255,255,255,.04), inset 0 0 0 57px rgba(255,255,255,.14); }
.sc-sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, rgba(225,29,72,.6), rgba(225,29,72,0) 38%); }
.sc-me { position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: #E11D48;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.sc-hp { position: absolute; width: 14px; height: 14px; border-radius: 50%; background: #10B981; border: 2px solid #fff; }
.sc-hp.h1 { left: 22%; top: 24%; } .sc-hp.h2 { left: 70%; top: 34%; } .sc-hp.h3 { left: 58%; top: 74%; }
.sc-112 { display: flex; align-items: center; gap: 10px; padding: 9px 14px; background: #fff; border-radius: 14px; color: #8B0D3D; }
.sc-112 b { font: 900 17px Sora, sans-serif; } .sc-112 .sc-nbars { width: 54px; }

.sc-find { background: linear-gradient(170deg, #6E0A30, #2A0A16); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 30px; }
.sc-bell { position: relative; width: 84px; height: 84px; border-radius: 50%; background: #fff; color: #8B0D3D; display: flex; align-items: center; justify-content: center; }
.sc-bellIco { display: inline-flex; transform-origin: 50% 10%; }
.sc-lockmsg { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3); border-radius: 14px; }
.sc-lockmsg .sc-nbars { width: 74px; } .sc-lockmsg .sc-nbars i { background: rgba(255,255,255,.55); }


.sc-spd { position: relative; background: linear-gradient(180deg, #3A1020, #14040A); color: #fff; }
.sc-lane { position: absolute; left: 20%; right: 20%; top: 0; bottom: 0; border-left: 3px solid rgba(255,255,255,.35); border-right: 3px solid rgba(255,255,255,.35); overflow: hidden; }
.sc-dashes { position: absolute; left: 50%; top: -60px; width: 6px; margin-left: -3px; }
.sc-dashes i { display: block; height: 32px; margin-bottom: 28px; border-radius: 3px; background: rgba(255,255,255,.55); }
.sc-limit { position: absolute; left: 50%; top: 18px; width: 62px; height: 62px; margin-left: -31px; border-radius: 50%; background: #fff;
  border: 7px solid #E11D48; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,.45); }
.sc-limit b { font: 900 22px Sora, sans-serif; color: #2A0A16; }
.sc-car { position: absolute; left: 50%; bottom: 84px; width: 40px; height: 74px; margin-left: -20px; filter: drop-shadow(0 8px 10px rgba(0,0,0,.55)); }
.sc-car svg { display: block; }
.sc-kmh { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: baseline; gap: 5px; padding: 8px 18px;
  border-radius: 14px; background: #E11D48; box-shadow: 0 6px 20px rgba(225,29,72,.5); white-space: nowrap; }
.sc-kmh b { font: 900 24px Sora, sans-serif; } .sc-kmh span { font: 800 12px Inter, sans-serif; opacity: .9; }

/* the live family map: a street map, with the family moving along the streets */
.kl-mapart.mp { height: 150px; overflow: hidden; background: #F4E1EA; }
.mp-pan { position: absolute; left: -14px; top: -10px; width: 220px; height: 170px; }
.mp-svg { display: block; }
.mp-m { position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; border: 3px solid #fff;
  box-shadow: 0 2px 8px rgba(139,13,61,.45); offset-rotate: 0deg; }
.mp-m::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; background: inherit; opacity: 0; }
.mp-m.m1 { background: #8B0D3D; offset-path: path('M44 48 V112 H110'); }
.mp-m.m2 { background: #B01650; offset-path: path('M176 48 V112 H110'); }
.mp-m.m3 { background: #10B981; offset-path: path('M110 48 H176 V112'); }
.mp-zoom { position: absolute; right: 8px; top: 8px; display: grid; width: 22px; border-radius: 8px; overflow: hidden; background: #fff;
  box-shadow: 0 2px 8px rgba(139,13,61,.25); }
.mp-zoom b { display: flex; align-items: center; justify-content: center; height: 21px; font: 700 14px/1 Inter, sans-serif; color: #6E0A30; }
.mp-zoom b + b { border-top: 1px solid #F0D5DF; }
@keyframes klWalk { from { offset-distance: 0%; } to { offset-distance: 100%; } }
@keyframes klPan { from { transform: translate(0, 0); } to { transform: translate(10px, 8px); } }
@keyframes klDash { to { stroke-dashoffset: -18; } }
@media (prefers-reduced-motion: no-preference) {
  .kl-sc.cur .mp-pan { animation: klPan 14s ease-in-out infinite alternate; }
  .kl-sc.cur .mp-m.m1 { animation: klWalk 8s ease-in-out infinite alternate; }
  .kl-sc.cur .mp-m.m2 { animation: klWalk 10s ease-in-out -3s infinite alternate; }
  .kl-sc.cur .mp-m.m3 { animation: klWalk 12s ease-in-out -6s infinite alternate; }
  .kl-sc.cur .mp-m::after { animation: klPulse 2.4s ease-out infinite; }
  .kl-sc.cur .mp-m.m2::after { animation-delay: .8s; } .kl-sc.cur .mp-m.m3::after { animation-delay: 1.6s; }
  .kl-sc.cur .mp-route { animation: klDash 1.6s linear infinite; }
}

@keyframes klSpin { to { transform: rotate(360deg); } }
@keyframes klShake { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(16deg); } 30% { transform: rotate(-14deg); } 45% { transform: rotate(10deg); } 60% { transform: rotate(-8deg); } 75% { transform: rotate(4deg); } }
@keyframes klWave { 0%, 100% { transform: scaleY(.25); } 50% { transform: scaleY(1); } }
@keyframes klDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes klThumb { from { left: 4%; } to { left: 96%; } }
@keyframes klBatt { from { width: 18%; } to { width: 78%; } }
@keyframes klSway { from { transform: translateX(-3px); } to { transform: translateX(3px); } }
@keyframes klRoad { from { transform: translateY(0); } to { transform: translateY(60px); } }
@keyframes klBlink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: no-preference) {
  .kl-sc.cur .sc-route { animation: klDraw 2.2s ease-in-out both; }
  .kl-sc.cur .sc-thumb { animation: klThumb 2.6s ease-in-out infinite alternate; }
  .kl-sc.cur .sc-batt b { animation: klBatt 1.6s ease-out both; }
  .kl-sc.cur .sc-sig s:nth-child(4) { animation: klBlink 1.4s ease-in-out infinite; }
  .kl-sc.cur .sc-car { animation: klSway 1.5s ease-in-out infinite alternate; }
  .kl-sc.cur .sc-dashes { animation: klRoad .7s linear infinite; }
  .kl-sc.cur .sc-kmh { animation: klBlink 1s ease-in-out infinite; }
  .kl-sc.cur .sc-limit { animation: klGeo 1.2s ease-in-out infinite; }
  .kl-sc.cur .sc-sweep { animation: klSpin 2.4s linear infinite; }
  .kl-sc.cur .sc-hp { animation: klUp .5s both; } .kl-sc.cur .sc-hp.h1 { animation-delay: .5s; }
  .kl-sc.cur .sc-hp.h2 { animation-delay: 1.1s; } .kl-sc.cur .sc-hp.h3 { animation-delay: 1.7s; }
  .kl-sc.cur .sc-bellIco { animation: klShake 1.3s ease-in-out infinite; }
  .kl-sc.cur .sc-wave s { animation: klWave 1s ease-in-out infinite; }
  .kl-sc.cur .sc-wave s:nth-child(2) { animation-delay: .12s; } .kl-sc.cur .sc-wave s:nth-child(3) { animation-delay: .24s; }
  .kl-sc.cur .sc-wave s:nth-child(4) { animation-delay: .36s; } .kl-sc.cur .sc-wave s:nth-child(5) { animation-delay: .48s; }
  .kl-sc.cur .sc-wave s:nth-child(6) { animation-delay: .6s; } .kl-sc.cur .sc-wave s:nth-child(7) { animation-delay: .72s; }
  .kl-sc.cur .sc-lockmsg, .kl-sc.cur .sc-112 { animation: klUp .6s .35s both; }
}


/* ── the phone page: all twelve features running at once, six over six ── */
.kl-slide[data-id="show"] .kl-in { max-width: 1320px; }
.kl-phones { --z: .6; display: grid; grid-template-columns: repeat(6, max-content); justify-content: center; gap: 28px 36px; margin-top: 0; }
.kl-fp { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.kl-fp .kl-phone { zoom: var(--z); }
.kl-cap { display: inline-flex; align-items: center; justify-content: center; text-align: center; gap: 6px; width: 100%; max-width: calc(210px * var(--z) + 8px);
  min-height: 42px; padding: 6px 10px; border-radius: 16px; font: 800 12.5px/1.25 Inter, sans-serif;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.kl-cap svg { flex-shrink: 0; }
/* On a wide screen the captions stay on one line, and the columns grow to fit them, which also opens up the space
   between the phones. The captions are kept short in every language so that all six fit across. */
@media (min-width: 1100px) {
  .kl-phones { column-gap: 30px; row-gap: 56px; }
  .kl-cap { width: auto; max-width: none; min-height: 0; white-space: nowrap; padding: 6px 12px; border-radius: 999px; font-size: clamp(10.5px, .86vw, 12.5px); }
}
/* paused: off screen, or stopped with the button */
.kl-phones.paused *, .kl-phones.paused *::before, .kl-phones.paused *::after { animation-play-state: paused !important; }
/* The phone page starts right under the Kinest bar and the two rows have to end above the footer pills,
   so the phone size follows the screen height (two rows plus the title: about 696 x size + 380 px). */
.kl-showhead { position: absolute; z-index: 3; top: 66px; left: 24px; display: flex; align-items: center; pointer-events: none; }
.kl-showhead .kl-eyebrow { margin: 0; padding: 4px 13px; font-size: clamp(14px, 1.15vw, 17px); }
@media (min-width: 761px) { .kl-slide[data-id="show"] { padding-bottom: 88px; } .kl-slide[data-id="show"] .kl-in { margin: 0 auto auto; } }
@media (min-width: 1300px) and (min-height: 700px) { .kl-phones { --z: 0.46; } }
@media (min-width: 1300px) and (min-height: 760px) { .kl-phones { --z: 0.56; } }
@media (min-width: 1300px) and (min-height: 800px) { .kl-phones { --z: 0.63; } }
@media (min-width: 1300px) and (min-height: 840px) { .kl-phones { --z: 0.69; } }
@media (min-width: 1300px) and (min-height: 880px) { .kl-phones { --z: 0.75; } }
@media (min-width: 1300px) and (min-height: 940px) { .kl-phones { --z: 0.83; } }
@media (min-width: 1300px) and (min-height: 1000px) { .kl-phones { --z: 0.91; } }
/* the largest size does not fit six across on a screen under about 1550px wide */
@media (min-width: 1300px) and (max-width: 1549px) and (min-height: 1000px) { .kl-phones { --z: .82; } }
/* narrower: four across (three rows), the slide scrolls if it has to */
@media (max-width: 1299px) { .kl-phones { grid-template-columns: repeat(4, max-content); --z: .62; } }
@media (min-width: 900px) and (max-width: 1299px) { .kl-phones { --z: .8; } }
/* phones: two across */
@media (max-width: 760px) { .kl-phones { grid-template-columns: repeat(2, max-content); --z: .72; gap: 22px 22px; } .kl-showhead { top: 62px; left: 16px; } }
@media (max-width: 359px) { .kl-phones { --z: .6; } }

@media (max-width: 760px) {
  .kl-slide { padding: 128px 18px 170px; }
  .kl-herogrid { grid-template-columns: minmax(0, 1fr); height: auto; }
  .kl-grid.two { grid-template-columns: 1fr; }
  /* the slide scrolls under the bar on a short screen: fade it out behind the bar */
  .kl-top { padding: 14px 16px 26px; background: linear-gradient(#FFFBFC 45%, rgba(255,251,252,0)); }
  .kl[data-dark="true"] .kl-top { background: linear-gradient(#7B0A36 45%, rgba(123,10,54,0)); }
  .kl-top { padding-top: 14px; } .kl-bot { padding: 12px 16px 14px; flex-wrap: wrap; justify-content: center; }
  .kl-legal { justify-content: center; order: 2; width: 100%; gap: 6px 8px; font-size: 12px; }
  /* the slide scrolls under the bottom bar on a short screen: fade it out behind the bar, like the top one */
  .kl-bot { padding-top: 40px; background: linear-gradient(rgba(255,251,252,0), #FFFBFC 58%); }
  .kl[data-dark="true"] .kl-bot { background: linear-gradient(rgba(110,10,48,0), rgb(110,10,48) 58%); }
  .kl-legal a { padding: 10px 13px; }
  .kl-nav { margin-left: 0; }
  .kl[data-home="false"] .kl-slide { padding-bottom: 100px; }
  .kl-arrow { display: none; }
  .kl-langwrap { width: 132px; }
}
`

const SHOW = [
  { id: 'map',      icon: 'map',     key: 'landing.showMap' },
  { id: 'timeline', icon: 'clock',   key: 'landing.showTimeline' },
  { id: 'arrive',   icon: 'pin',     key: 'landing.showArrive' },
  { id: 'status',   icon: 'heart',   key: 'landing.showStatus' },
  { id: 'sos',      icon: 'siren',   key: 'landing.showSos' },
  { id: 'voice',    icon: 'mic',     key: 'landing.showVoice' },
  { id: 'nearby',   icon: 'radar',   key: 'landing.showNearby' },
  { id: 'call',     icon: 'video',   key: 'landing.showCall' },
  { id: 'chat',     icon: 'message', key: 'landing.showChat' },
  { id: 'find',     icon: 'bell',    key: 'landing.showFind' },
  { id: 'speed',    icon: 'car',     key: 'landing.showSpeed' },
  { id: 'offline',  icon: 'radio',   key: 'landing.showOffline' },
]
const AV = ['#8B0D3D', '#B01650', '#10B981']

function Avatars() {
  return (
    <div className="sc-avs">
      {AV.map((c, i) => <span className="sc-av" key={i} style={{ background: c }}><Icon name="checkCircle" size={13} /></span>)}
    </div>
  )
}

function ShowScreen({ id }) {
  switch (id) {
    case 'map':
      return (
        <div style={{ background: '#FDF0F5', height: '100%' }}>
          <div className="kl-mapart mp">
            <div className="mp-pan">
              <svg className="mp-svg" viewBox="0 0 220 170" width="220" height="170" aria-hidden="true">
                <rect x="-10" y="-10" width="240" height="190" fill="#F4E1EA" />
                <g fill="#FBEFF4">
                  <rect x="-10" y="-10" width="48" height="52" rx="6" /><rect x="50" y="-10" width="54" height="52" rx="6" />
                  <rect x="116" y="-10" width="54" height="52" rx="6" /><rect x="182" y="-10" width="48" height="52" rx="6" />
                  <rect x="-10" y="54" width="48" height="52" rx="6" /><rect x="116" y="54" width="54" height="52" rx="6" /><rect x="182" y="54" width="48" height="52" rx="6" />
                  <rect x="-10" y="118" width="48" height="62" rx="6" /><rect x="50" y="118" width="54" height="62" rx="6" />
                  <rect x="116" y="118" width="54" height="62" rx="6" /><rect x="182" y="118" width="48" height="62" rx="6" />
                </g>
                <g fill="#F0D6E1">
                  <rect x="56" y="-2" width="18" height="14" rx="2" /><rect x="80" y="12" width="16" height="20" rx="2" />
                  <rect x="124" y="4" width="22" height="16" rx="2" /><rect x="148" y="20" width="14" height="14" rx="2" />
                  <rect x="-2" y="62" width="18" height="18" rx="2" /><rect x="190" y="64" width="20" height="16" rx="2" />
                  <rect x="124" y="64" width="16" height="22" rx="2" /><rect x="146" y="78" width="16" height="16" rx="2" />
                  <rect x="58" y="124" width="20" height="14" rx="2" /><rect x="190" y="124" width="22" height="16" rx="2" />
                </g>
                <rect x="50" y="54" width="54" height="52" rx="9" fill="#CFE9DA" />
                <g fill="#B5DAC4"><circle cx="64" cy="68" r="6" /><circle cx="80" cy="84" r="7" /><circle cx="92" cy="66" r="5" /><circle cx="68" cy="94" r="5" /></g>
                <path d="M-10 152 C 40 130, 80 170, 130 148 S 200 152 232 134" fill="none" stroke="#C9DFEF" strokeWidth="15" strokeLinecap="round" />
                <g stroke="#EBD0DB" strokeWidth="10" strokeLinecap="round" fill="none">
                  <path d="M-10 48 H230 M-10 112 H230 M44 -10 V180 M110 -10 V180 M176 -10 V180" />
                </g>
                <g stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" fill="none">
                  <path d="M-10 48 H230 M-10 112 H230 M44 -10 V180 M110 -10 V180 M176 -10 V180" />
                </g>
                <path className="mp-route" d="M44 48 V112 H110" fill="none" stroke="#8B0D3D" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" opacity=".6" />
              </svg>
              <span className="mp-m m1" /><span className="mp-m m2" /><span className="mp-m m3" />
            </div>
            <div className="mp-zoom"><b>+</b><b>&minus;</b></div>
          </div>
          {AV.map((c, i) => (
            <div className="kl-row" key={i}>
              <span className="kl-av" style={{ background: c }} />
              <div style={{ flex: 1 }}>
                <div className="kl-bar" style={{ width: `${70 - i * 12}%` }} />
                <div className="kl-bar" style={{ width: '40%', marginTop: 5, opacity: .6 }} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'timeline':
      return (
        <div className="sc-tl" style={{ height: '100%' }}>
          <svg viewBox="0 0 192 250" width="100%" height="250" aria-hidden="true">
            <path className="sc-route" pathLength="1" d="M28 70 C 70 20, 118 150, 160 96 S 150 205, 82 214"
              fill="none" stroke="#8B0D3D" strokeWidth="4" strokeLinecap="round" strokeDasharray="1" />
            <circle cx="28" cy="70" r="7" fill="#10B981" stroke="#fff" strokeWidth="3" />
            <circle cx="82" cy="214" r="7" fill="#8B0D3D" stroke="#fff" strokeWidth="3" />
          </svg>
          <div className="sc-slider">
            <div className="sc-trk"><span className="sc-thumb" /></div>
            <div className="sc-tbars"><i /><i /><i /></div>
          </div>
        </div>
      )
    case 'status':
      return (
        <div className="sc-st" style={{ height: '100%' }}>
          <div className="sc-stTop">
            <span className="kl-av" style={{ background: AV[0] }} />
            <div className="sc-nbars"><i style={{ width: '70%' }} /><i style={{ width: '40%' }} /></div>
          </div>
          <div className="sc-tiles">
            <div className="sc-tile"><div className="sc-batt"><b /></div><i /></div>
            <div className="sc-tile"><Icon name="wSun" size={30} color="#F59E0B" /><i /></div>
            <div className="sc-tile"><div className="sc-sig"><s /><s /><s /><s /></div><i /></div>
          </div>
          <div className="sc-tile wide">
            <Icon name="clock" size={20} color="#8B0D3D" />
            <div className="sc-nbars" style={{ flex: 1 }}><i style={{ width: '60%' }} /></div>
          </div>
        </div>
      )
    case 'voice':
      return (
        <div className="sc-voice" style={{ height: '100%' }}>
          <div className="sc-mic">
            <span className="sc-ring" /><span className="sc-ring" />
            <Icon name="mic" size={32} />
          </div>
          <div className="sc-wave"><s /><s /><s /><s /><s /><s /><s /></div>
          <div className="sc-photo"><Icon name="camera" size={22} /></div>
        </div>
      )
    case 'nearby':
      return (
        <div className="sc-near" style={{ height: '100%' }}>
          <div className="sc-radar">
            <span className="sc-sweep" />
            <span className="sc-hp h1" /><span className="sc-hp h2" /><span className="sc-hp h3" />
            <span className="sc-me"><Icon name="pin" size={18} /></span>
          </div>
          <div className="sc-112"><b>112</b><div className="sc-nbars"><i style={{ width: '100%' }} /><i style={{ width: '58%' }} /></div></div>
        </div>
      )
    case 'find':
      return (
        <div className="sc-find" style={{ height: '100%' }}>
          <div className="sc-bell">
            <span className="sc-ring" /><span className="sc-ring" />
            <span className="sc-bellIco"><Icon name="bell" size={34} /></span>
          </div>
          <div className="sc-lockmsg">
            <Icon name="lock" size={16} />
            <div className="sc-nbars"><i style={{ width: '100%' }} /><i style={{ width: '60%' }} /></div>
          </div>
        </div>
      )
    case 'speed':
      return (
        <div className="sc-spd" style={{ height: '100%' }}>
          <div className="sc-lane"><div className="sc-dashes">{[0, 1, 2, 3, 4, 5, 6, 7].map(n => <i key={n} />)}</div></div>
          <div className="sc-limit"><b>60</b></div>
          <div className="sc-car">
            <svg viewBox="0 0 40 74" width="40" height="74" aria-hidden="true">
              <rect x="0.5" y="11" width="5" height="13" rx="2.5" fill="#0B0206" />
              <rect x="34.5" y="11" width="5" height="13" rx="2.5" fill="#0B0206" />
              <rect x="0.5" y="49" width="5" height="13" rx="2.5" fill="#0B0206" />
              <rect x="34.5" y="49" width="5" height="13" rx="2.5" fill="#0B0206" />
              <rect x="4" y="2" width="32" height="70" rx="13" fill="#fff" />
              <path d="M9.5 25 L12.5 13.5 Q20 10.5 27.5 13.5 L30.5 25 Q20 22.5 9.5 25 Z" fill="#2A0A16" />
              <rect x="9" y="29" width="22" height="19" rx="5" fill="#F3D6E0" />
              <path d="M10 51 Q20 49 30 51 L28 58.5 Q20 60.5 12 58.5 Z" fill="#2A0A16" />
              <rect x="7.5" y="66" width="8" height="3.4" rx="1.7" fill="#E11D48" />
              <rect x="24.5" y="66" width="8" height="3.4" rx="1.7" fill="#E11D48" />
              <rect x="7.5" y="3.6" width="7" height="3" rx="1.5" fill="#FDE68A" />
              <rect x="25.5" y="3.6" width="7" height="3" rx="1.5" fill="#FDE68A" />
            </svg>
          </div>
          <div className="sc-kmh"><b>78</b><span>km/h</span></div>
        </div>
      )
    case 'sos':
      return (
        <div className="sc-sos" style={{ height: '100%' }}>
          <div className="sc-sosC">
            <span className="sc-ring" /><span className="sc-ring" />
            <div className="sc-sosBtn"><Icon name="siren" size={38} /></div>
          </div>
          <Avatars />
          <div className="sc-bar" style={{ width: '56%' }} />
        </div>
      )
    case 'call':
      return (
        <div className="sc-call" style={{ height: '100%' }}>
          <div className="sc-callAv">
            <span className="sc-ring" /><span className="sc-ring" />
            <Icon name="user" size={34} />
          </div>
          <div className="sc-bar" style={{ width: 96 }} />
          <div className="sc-bar" style={{ width: 56, opacity: .6 }} />
          <div className="sc-callBtns">
            <span><Icon name="mic" size={18} /></span>
            <span className="end"><Icon name="phone" size={18} /></span>
            <span><Icon name="video" size={18} /></span>
          </div>
        </div>
      )
    case 'chat':
      return (
        <div className="sc-chat" style={{ height: '100%' }}>
          <div className="sc-head" />
          <div className="sc-b in"><i style={{ width: 90 }} /><i style={{ width: 54 }} /></div>
          <div className="sc-b out"><i style={{ width: 70 }} /></div>
          <div className="sc-b in"><i style={{ width: 80 }} /></div>
          <div className="sc-b out"><i style={{ width: 96 }} /><i style={{ width: 40 }} /></div>
          <div className="sc-typing"><s /><s /><s /></div>
        </div>
      )
    case 'arrive':
      return (
        <div className="sc-arr" style={{ height: '100%' }}>
          <div className="sc-geo"><span className="sc-pin"><Icon name="pin" size={22} /></span></div>
          <div className="sc-notif">
            <span className="sc-nico"><Icon name="bell" size={16} /></span>
            <div className="sc-nbars"><i style={{ width: '80%' }} /><i style={{ width: '48%' }} /></div>
            <Icon name="checkCircle" size={18} />
          </div>
        </div>
      )
    default: // offline
      return (
        <div className="sc-off" style={{ height: '100%' }}>
          <div className="sc-nonet"><Icon name="radio" size={30} /></div>
          <div className="sc-sms">
            <b>SMS</b><Icon name="pin" size={15} />
            <div className="sc-nbars"><i style={{ width: '100%' }} /><i style={{ width: '60%' }} /></div>
          </div>
          <Avatars />
        </div>
      )
  }
}

/**
 * The phone page: all twelve features at once, six phones over six, each one
 * running its own little animation. Purely decorative (aria-hidden on the
 * phones); the same features are listed as text on the Features slide.
 *
 * The animations only run while this slide is on screen and are paused
 * otherwise (twelve running at once is not free). People who ask for reduced
 * motion get them still: the animations are already left out of their stylesheet.
 */
function PhoneGrid({ running, t }) {
  return (
      <div className={`kl-phones${running ? '' : ' paused'}`}>
        {SHOW.map((x, n) => (
          <div className="kl-fp" key={x.id}>
            <div className="kl-phone" aria-hidden="true" style={{ animationDelay: `${0.1 + n * 0.06}s` }}>
              <div className="kl-screen">
                <div className="kl-stage">
                  <div className="kl-sc cur"><ShowScreen id={x.id} /></div>
                </div>
              </div>
            </div>
            <div className="kl-cap"><Icon name={x.icon} size={14} />{t(x.key)}</div>
          </div>
        ))}
      </div>
  )
}

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

export default function LandingPage() {
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
  const download = PLAY_STORE_URL
    ? <a className="kl-btn light" href={PLAY_STORE_URL} rel="noopener"><PlayGlyph />{t('landing.getApp')}</a>
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
