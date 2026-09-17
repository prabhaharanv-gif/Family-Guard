// Line icons for the .auth-logo tile on the onboarding, create-family and
// join-family pages. SVG rather than emoji: an emoji is drawn by the phone's
// own font, so it looked different on every brand and ignored the maroon.
const common = {
  width: 38, height: 38, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function KeyIcon() {
  return (
    <svg {...common}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

export function FamilyIcon() {
  return (
    <svg {...common}>
      <circle cx="9" cy="7" r="3.2" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3a4.5 4.5 0 0 1 4.5 4.5V20" />
      <circle cx="17.5" cy="9" r="2.4" />
      <path d="M17 14h1a3.5 3.5 0 0 1 3.5 3.5V20" />
    </svg>
  )
}
