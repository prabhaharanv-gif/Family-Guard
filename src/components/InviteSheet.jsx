import { useState } from 'react'
import Icon from './Icon'
import { useT } from '../i18n'

/**
 * Invite sheet: the invite code lives in the house.
 *
 * A night scene with a two-storey home. Each character of the code is a window
 * that lights up in turn, like the family coming home; a gold heart sits in the
 * gable. Copying or sharing opens the door on the family waiting inside. Only
 * the two buttons under the house act; the picture itself is not tappable.
 *
 * Shares THIS family's invite code. Whoever enters it on the Join Family screen
 * creates a join_request an admin must accept, so the code alone never grants
 * access — the note under the scene says so.
 *
 * The house is the only place the code is shown, so it is also in the button
 * aria-label. Codes are uppercase hex (0-9, A-F): no O to mistake for a zero.
 * The window row adapts to the code length, so a legacy shorter code still fits.
 *
 * No new strings: every label already exists in ui.js in all six languages.
 */

const MAROON  = '#8B0D3D'
const DEEP    = '#6E0A30'
const DARKEST = '#48061F'
const GOLD    = '#D4AF37'
const CREAM   = '#FFF8F0'

// House walls span x 36..304; the window row sits inside them with a margin.
const WALL_L = 36, WALL_W = 268, MARGIN = 14.5, GAP = 7
const WIN_Y = 100, WIN_H = 38

function Home({ chars }) {
  const n = Math.max(chars.length, 1)
  const avail = WALL_W - 2 * MARGIN
  const w = (avail - (n - 1) * GAP) / n
  const fontSize = Math.min(24, w * 0.72)

  return (
    <svg className="invite-svg" viewBox="0 0 340 196" aria-hidden="true" focusable="false">
      {/* sky: moon and stars */}
      <path d="M306 20 a16 16 0 1 0 6 28 a13 13 0 1 1 -6 -28Z" fill={CREAM} />
      <circle className="inv-star"    cx="70"  cy="22" r="1.7" />
      <circle className="inv-star k2" cx="118" cy="12" r="1.3" />
      <circle className="inv-star k3" cx="150" cy="32" r="1.5" />
      <circle className="inv-star k2" cx="214" cy="18" r="1.6" />
      <circle className="inv-star"    cx="262" cy="56" r="1.3" />
      <circle className="inv-star k3" cx="328" cy="86" r="1.4" />
      <circle className="inv-star k2" cx="52"  cy="60" r="1.2" />

      {/* ground and the path to the door */}
      <rect x="0" y="180" width="340" height="32" fill="#2A0412" />
      <path d="M150 212 L190 212 L183 180 L157 180 Z" fill="#5D371D" />

      {/* trees */}
      <g className="inv-tree">
        <rect x="13" y="160" width="6" height="22" fill="#3A0A1A" />
        <circle cx="16" cy="150" r="15" fill={DEEP} />
      </g>
      <g className="inv-tree" style={{ animationDelay: '-2.3s' }}>
        <rect x="321" y="160" width="6" height="22" fill="#3A0A1A" />
        <circle cx="324" cy="150" r="15" fill={DEEP} />
      </g>

      {/* chimney, smoke */}
      <rect x="246" y="48" width="14" height="30" fill={DEEP} />
      <circle className="inv-smoke"    cx="253" cy="44" r="3.2" />
      <circle className="inv-smoke s2" cx="253" cy="44" r="3.2" />
      <circle className="inv-smoke s3" cx="253" cy="44" r="3.2" />

      {/* walls, roof */}
      <rect x={WALL_L} y="90" width={WALL_W} height="90" fill={CREAM} />
      <path d="M22 92 L170 36 L318 92 Z" fill={MAROON} />
      <path d="M22 92 L170 36 L318 92" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

      {/* the heart in the gable */}
      <g transform="translate(160.4 57) scale(0.8)">
        <path className="inv-heart" fill={GOLD}
          d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
      </g>

      {/* upper floor: one window per code character */}
      {chars.map((c, i) => {
        const x = WALL_L + MARGIN + i * (w + GAP)
        return (
          <g key={i} style={{ '--i': i }}>
            <rect className="inv-pane" x={x} y={WIN_Y} width={w} height={WIN_H} rx="3"
              stroke={MAROON} strokeWidth="2" />
            <text className="inv-char" x={x + w / 2} y={WIN_Y + WIN_H / 2 + fontSize * 0.36}
              textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="900"
              fontSize={fontSize} fill={DARKEST}>{c}</text>
          </g>
        )
      })}

      {/* ground floor: two windows, the door, a lamp on each side */}
      <g stroke={MAROON} strokeWidth="1.6">
        <rect className="inv-gwin" x="64"  y="152" width="32" height="22" rx="3" />
        <path d="M80 152V174M64 163H96" />
        <rect className="inv-gwin" x="244" y="152" width="32" height="22" rx="3" />
        <path d="M260 152V174M244 163H276" />
      </g>
      <circle className="inv-lamp"    cx="139" cy="160" r="3.4" fill={GOLD} />
      <circle className="inv-lamp l2" cx="201" cy="160" r="3.4" fill={GOLD} />

      {/* doorway: gold room with the family inside, covered by the door leaf */}
      <path d="M152 180 V158 a18 18 0 0 1 36 0 V180 Z" fill={GOLD} />
      <g className="inv-fam" fill={DEEP}>
        <circle cx="161" cy="164" r="3.3" /><rect x="157.3" y="168" width="7.4" height="12" rx="3.7" />
        <circle cx="170" cy="171" r="2.6" /><rect x="167.2" y="174" width="5.6" height="6" rx="2.8" />
        <circle cx="179" cy="164" r="3.3" /><rect x="175.3" y="168" width="7.4" height="12" rx="3.7" />
      </g>
      <g className="inv-door">
        <path d="M152 180 V158 a18 18 0 0 1 36 0 V180 Z" fill={DARKEST} />
        <path d="M159 180 V160 a11 11 0 0 1 22 0 V180" fill="none" stroke={GOLD} strokeOpacity="0.55" strokeWidth="1.4" />
        <circle cx="183" cy="171" r="2" fill={GOLD} />
      </g>
      <path d="M150 180 V158 a20 20 0 0 1 40 0 V180" fill="none" stroke={GOLD} strokeWidth="2.6" />
      <rect x="146" y="180" width="48" height="4" rx="2" fill={GOLD} fillOpacity="0.5" />

      {/* the key, swinging from the corner */}
      <g className="inv-key">
        <line x1="28" y1="0" x2="28" y2="17" stroke={CREAM} strokeOpacity="0.7" strokeWidth="1.4" />
        <circle cx="28" cy="25" r="6.5" fill="none" stroke={GOLD} strokeWidth="2.6" />
        <circle cx="28" cy="25" r="1.8" fill={GOLD} />
        <path d="M28 31.5 V62 M28 53 h7 M28 60 h5" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

export default function InviteSheet({ familyName, code, onClose }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  // Sharing opens the door too, but must not light up the Copy button.
  const [shared, setShared] = useState(false)
  const chars = String(code || '').split('')

  const copy = () => {
    // Best-effort: clipboard is unavailable in some WebView configs, and the
    // code is on screen anyway, so failing is not worth an error.
    try { navigator.clipboard?.writeText(code) } catch { /* shown above */ }
    setCopied(true)
    // Long enough to watch the door open before the sheet goes away.
    setTimeout(() => { setCopied(false); onClose() }, 1800)
  }

  const shareWhatsapp = () => {
    const msg = encodeURIComponent(t('family.whatsappMsg', { code }))
    window.open(`https://wa.me/?text=${msg}`, '_blank')
    setShared(true)
    setTimeout(() => setShared(false), 2400)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}
        style={{ padding: '4px 20px max(26px, calc(14px + env(safe-area-inset-bottom, 0px)))' }}>
        <div className="popup-handle" style={{ margin: '9px auto 14px' }} />

        <div className={`invite-scene${copied || shared ? ' is-open' : ''}`}>
          <div className="invite-scene-title">
            {t('family.inviteTo', { family: familyName })}
          </div>
          <div className="invite-scene-art" role="img" aria-label={`${familyName}: ${code}`}>
            <Home chars={chars} />
          </div>

          {/* On the ground below the house: each action sits under the window on
              its own side. */}
          <div className="invite-ground">
            <button type="button" className={`inv-act inv-act-copy${copied ? ' is-copied' : ''}`} onClick={copy}>
              <Icon name="copy" size={19} strokeWidth={2} />
              <span>{copied ? t('family.copied') : t('family.copyCode')}</span>
            </button>
            <span className="inv-spacer" aria-hidden="true" />
            <button type="button" className="inv-act inv-act-share" onClick={shareWhatsapp}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.118 1.522 5.852L.057 23.25a.75.75 0 0 0 .916.916l5.404-1.464A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.65-.502-5.17-1.381l-.37-.218-3.835 1.04 1.04-3.834-.218-.371A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
              </svg>
              <span>{t('family.shareWhatsapp')}</span>
            </button>
          </div>

          <div className="invite-scene-note">
            {t('family.joinScreenNote').split(/\r?\n/).map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
