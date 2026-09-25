/**
 * FamilyIllustration
 *
 * Decorative outline drawing that fills the empty space under a short family
 * list. Line art only, in a soft pink at low opacity, so it reads as a
 * watermark on the cream background and never competes with the member cards
 * above it. Pink rather than the maroon of the header and buttons: at
 * watermark weight the maroon went muddy grey-brown against cream, while the
 * pink stays legibly rosy.
 *
 * The motif is the app icon's, redrawn as line art so the Family page echoes
 * the icon people tap to open the app: a ring, a roof with its chimney, and a
 * family of four holding hands beneath it, with a small heart under the roof.
 * The icon's shield-and-lock is left out on purpose — at watermark size it
 * turns into an unreadable blob, and a lock reads as "locked" rather than
 * "safe"; the roof and ring already say protected.
 *
 * Sized to about the height of the drawing it replaced (a ring needs a
 * square box, so it is narrower), which keeps the invite FAB clear of it.
 *
 * aria-hidden — it is purely decorative and adds nothing for a screen reader.
 */
export default function FamilyIllustration({ width = 190, opacity = 0.6 }) {
  return (
    <svg
      width={width}
      viewBox="0 0 240 200"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', maxWidth: '100%', opacity }}
    >
      <g
        stroke="#E79BBB"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Ring around everything, as on the icon */}
        <circle cx="120" cy="100" r="92" opacity="0.6" />

        {/* Roof, raised to make room for bigger figures; chimney on the right
            slope. Ends stop short of the ring (same slope, 8 units in) — at
            full length they met it on a phone screen and the roof read as
            part of the ring. */}
        <path d="M46 76.3 L120 24 L194 76.3" />
        <path d="M160 52.3 V36 H171 V60.1" />

        {/* Heart under the roof peak */}
        <path
          d="M12 21s-6.5-4.35-9-8.2C1.2 10 2.3 6.2 5.6 5.2 8 4.5 10.4 5.6 12 7.6c1.6-2 4-3.1 6.4-2.4 3.3 1 4.4 4.8 2.6 7.6-2.5 3.85-9 8.2-9 8.2z"
          transform="translate(111 34) scale(0.9)"
          strokeWidth="2"
        />

        {/* The family, drawn at the old size and enlarged 1.2x about the middle
            of their feet, lifted so the outer children's feet stay inside the
            ring where it narrows. Stroke is set so it comes out at the same
            2.4 as the ring and roof after scaling. */}
        <g transform="translate(121.5 152) scale(1.2) translate(-121.5 -162)" strokeWidth="2">
          {/* Child, left */}
          <circle cx="68" cy="118" r="7" />
          <path d="M60 162 V141 a8 8 0 0 1 16 0 V162" />
          <path d="M68 162 V150" />

          {/* Father */}
          <circle cx="97" cy="93" r="9.5" />
          <path d="M84 162 V122 a13 13 0 0 1 26 0 V162" />
          <path d="M97 162 V140" />

          {/* Mother, in a dress */}
          <circle cx="141" cy="95" r="9" />
          <path d="M131 116 Q141 106 151 116 L157 146 H125 Z" />
          <path d="M135 146 V162" />
          <path d="M147 146 V162" />

          {/* Child, right, in a dress */}
          <circle cx="171" cy="120" r="7" />
          <path d="M164 134 Q171 127 178 134 L183 151 H159 Z" />
          <path d="M166 151 V162" />
          <path d="M176 151 V162" />

          {/* Joined hands, left to right */}
          <path d="M76 142 Q80 140 84 134" />
          <path d="M110 134 Q119 137 128 128" />
          <path d="M153 128 Q159 133 163 138" />
        </g>
      </g>
    </svg>
  )
}
