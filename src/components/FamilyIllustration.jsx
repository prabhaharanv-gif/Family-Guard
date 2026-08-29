/**
 * FamilyIllustration
 *
 * Decorative outline drawing that fills the empty space under a short family
 * list. Line art only, in the maroon theme at low opacity, so it reads as a
 * watermark and never competes with the member cards above it.
 *
 * The motif carries the app's themes in one composition: a protective arc over
 * a house, a heart in the gable, and two parents standing close with two
 * children between them.
 *
 * aria-hidden — it is purely decorative and adds nothing for a screen reader.
 */
export default function FamilyIllustration({ width = 240, opacity = 0.22 }) {
  return (
    <svg
      width={width}
      viewBox="0 0 280 190"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', maxWidth: '100%', opacity }}
    >
      <g
        stroke="#951345"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Protective arc over everything */}
        <path d="M22 142 C22 34 258 34 258 142" opacity="0.55" />

        {/* Ground */}
        <path d="M34 162 H246" opacity="0.55" />

        {/* House */}
        <path d="M52 104 L96 68 L140 104" />
        <path d="M60 104 V162" />
        <path d="M132 104 V162" />
        {/* Door */}
        <path d="M88 162 V132 H104 V162" />

        {/* Heart in the gable */}
        <path
          d="M12 21s-6.5-4.35-9-8.2C1.2 10 2.3 6.2 5.6 5.2 8 4.5 10.4 5.6 12 7.6c1.6-2 4-3.1 6.4-2.4 3.3 1 4.4 4.8 2.6 7.6-2.5 3.85-9 8.2-9 8.2z"
          transform="translate(84 80)"
          strokeWidth="1.8"
        />

        {/* Parent, left */}
        <circle cx="170" cy="110" r="10" />
        <path d="M156 162 V140 a14 14 0 0 1 28 0 V162" />

        {/* Children, between the parents */}
        <circle cx="190" cy="133" r="7" />
        <path d="M181 162 V149 a9 9 0 0 1 18 0 V162" />
        <circle cx="209" cy="135" r="6.5" />
        <path d="M201 162 V151 a8 8 0 0 1 16 0 V162" />

        {/* Parent, right */}
        <circle cx="228" cy="110" r="10" />
        <path d="M214 162 V140 a14 14 0 0 1 28 0 V162" />
      </g>
    </svg>
  )
}
