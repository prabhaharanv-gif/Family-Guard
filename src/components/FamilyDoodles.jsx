import { useId } from 'react'

/**
 * FamilyDoodles
 *
 * A calm, wallpaper-like background for the Family page: a few tiny outline
 * drawings (house, heart, location pin, family, map, chat bubble, fence, a home
 * with a heart) scattered at slight angles, in the app's maroon at very low
 * opacity. It sits behind the member cards and must stay clearly secondary to
 * them, so it is deliberately sparse: about 18 small drawings in a 340 x 380
 * tile, spaced well apart, with no obvious rows and no clusters.
 *
 * The tile repeats to fill any height. Outlines only, no text, no animation.
 *
 * aria-hidden and not interactive: purely decorative.
 */

// Each drawing lives in a 24 x 24 box.
const ART = {
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  house: <><path d="M3 11 12 3l9 8" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
  homeheart: <><path d="M3 11 12 3l9 8" /><path d="M5 9.5V21h14V9.5" /><path d="M12 18c-2.2-1.5-3.2-2.5-3.2-3.7 0-1 .8-1.8 1.7-1.8.6 0 1.2.3 1.5.9.3-.6.9-.9 1.5-.9.9 0 1.7.8 1.7 1.8 0 1.2-1 2.2-3.2 3.7z" /></>,
  fence: <><path d="M2 21V9l2-2 2 2v12" /><path d="M9 21V9l2-2 2 2v12" /><path d="M16 21V9l2-2 2 2v12" /><path d="M1 12.5h22M1 17h22" /></>,
  family: <><circle cx="8" cy="6" r="2.4" /><path d="M4.5 21v-6.5a3.5 3.5 0 0 1 7 0V21" /><circle cx="17" cy="12" r="1.9" /><path d="M14.4 21v-4.2a2.6 2.6 0 0 1 5.2 0V21" /></>,
  map: <><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  chat: <><path d="M21 12a8.5 8.5 0 0 1-12.2 7.6L3.5 21l1.3-4.6A8.5 8.5 0 1 1 21 12z" /><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" /></>,
  pin: <><path d="M12 21s-6.5-5.7-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></>,
}

// kind, x, y, size, rotation (degrees) inside the 340 x 380 tile. Placed by hand
// with jitter so no two neighbours line up, and every icon keeps clear of its
// neighbours and of the tile edge (so the repeat has no seams).
const SCATTER = [
  ['house', 24, 26, 26, -6],
  ['heart', 112, 14, 18, 12],
  ['chat', 190, 34, 24, -8],
  ['pin', 274, 18, 22, 10],
  ['family', 56, 96, 28, 8],
  ['fence', 150, 110, 26, 3],
  ['heart', 244, 98, 16, -14],
  ['map', 296, 120, 24, 6],
  ['pin', 20, 184, 20, -10],
  ['homeheart', 100, 196, 26, 8],
  ['chat', 200, 178, 22, 12],
  ['fence', 268, 208, 26, -4],
  ['heart', 40, 276, 18, 10],
  ['map', 120, 288, 26, -10],
  ['family', 214, 280, 26, 6],
  ['house', 290, 300, 22, -8],
  ['fence', 64, 346, 24, 3],
  ['heart', 190, 352, 16, -12],
]

export default function FamilyDoodles({ opacity = 0.14 }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%" height="100%"
      style={{ display: 'block', pointerEvents: 'none', userSelect: 'none', opacity }}
    >
      <defs>
        <pattern id={id} width="340" height="380" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="var(--maroon)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            {SCATTER.map(([kind, x, y, size, rot], i) => (
              <g key={i} transform={`translate(${x} ${y}) rotate(${rot} ${size / 2} ${size / 2}) scale(${size / 24})`}>
                {ART[kind]}
              </g>
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
