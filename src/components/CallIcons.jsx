/**
 * CallIcons.jsx
 *
 * Inline SVG icons for the in-call controls, replacing the emoji the call
 * screen used to render.
 *
 * Emoji were a problem beyond looking unpolished: they are font glyphs, so
 * they rendered at the mercy of the device's emoji font, sat off-centre in
 * the round buttons, and could not take the maroon theme. Two of them (📷 and
 * 🎥) were near-identical on a single on/off toggle, which is what made the
 * camera button read as a front/back flip.
 *
 * All icons are 24x24, stroke-based, and draw in `currentColor` so the button
 * controls their colour. Filled variants are used for the phone glyphs, which
 * read better as solid shapes at this size.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Svg({ size = 22, children, ...rest }) {
  return <svg width={size} height={size} {...base} {...rest}>{children}</svg>
}

export function MicIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </Svg>
  )
}

export function MicOffIcon({ size }) {
  return (
    <Svg size={size}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M9 9v2a3 3 0 0 0 5.12 2.12" />
      <path d="M15 11V5a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-1" />
      <path d="M19 10v1a6.96 6.96 0 0 1-.11 1.23" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </Svg>
  )
}

export function SpeakerIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Svg>
  )
}

/** Speaker disabled — audio is on the earpiece rather than the loudspeaker. */
export function SpeakerOffIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </Svg>
  )
}

export function VideoIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </Svg>
  )
}

export function VideoOffIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M10.66 5H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </Svg>
  )
}

/** Front/back camera switch — circular arrows read as "rotate" at this size. */
export function FlipCameraIcon({ size }) {
  return (
    <Svg size={size}>
      <polyline points="22 4 22 10 16 10" />
      <polyline points="2 20 2 14 8 14" />
      <path d="M4.51 9a8 8 0 0 1 13.15-2.99L22 10" />
      <path d="M2 14l4.34 3.99A8 8 0 0 0 19.49 15" />
    </Svg>
  )
}

/** Answer — solid handset. */
export function PhoneIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 15.5a12.8 12.8 0 0 1-4-.64 1.1 1.1 0 0 0-1.11.27l-1.77 1.77a16.5 16.5 0 0 1-7.02-7.02l1.77-1.78a1.1 1.1 0 0 0 .27-1.1A12.8 12.8 0 0 1 7.5 3 1.1 1.1 0 0 0 6.4 2H3.6A1.1 1.1 0 0 0 2.5 3.1 18.5 18.5 0 0 0 21 21.5a1.1 1.1 0 0 0 1.1-1.1v-2.8a1.1 1.1 0 0 0-1.1-1.1z" />
    </svg>
  )
}

/** Hang up — the same handset, tipped down. */
export function PhoneOffIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <g transform="rotate(135 12 12)">
        <path d="M20 15.5a12.8 12.8 0 0 1-4-.64 1.1 1.1 0 0 0-1.11.27l-1.77 1.77a16.5 16.5 0 0 1-7.02-7.02l1.77-1.78a1.1 1.1 0 0 0 .27-1.1A12.8 12.8 0 0 1 7.5 3 1.1 1.1 0 0 0 6.4 2H3.6A1.1 1.1 0 0 0 2.5 3.1 18.5 18.5 0 0 0 21 21.5a1.1 1.1 0 0 0 1.1-1.1v-2.8a1.1 1.1 0 0 0-1.1-1.1z" />
      </g>
    </svg>
  )
}
