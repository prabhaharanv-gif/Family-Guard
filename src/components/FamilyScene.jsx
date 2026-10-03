import { arrange } from '../lib/familyBackground'
import { characterAsset, characterKey, sceneAsset, feetFor } from '../lib/familyAssets'

/**
 * Premium FamilyScene
 * Warm, privacy-friendly illustrated family scene.
 * People are always shown from behind; proportions come from family age/type data.
 *
 * Art files (src/assets/family, see its README) take over where they exist: a scene
 * backdrop image replaces the vector scene, and a character image replaces that person's
 * vector figure. Anything missing falls back to the vector drawing below.
 */

export const SCENE_W = 360
export const SCENE_H = 300

const FEET = 252
const TALLEST = 118

const SKIN = ['#E5B18F', '#D49A72', '#C98A63', '#EBC0A4']
const HAIR = ['#2C1A17', '#3A241D', '#4A2D22']
const CLOTHES = ['#7A1034', '#B64E6D', '#D88A3D', '#8A4B61', '#8FAF8D', '#6E8FB3', '#B96C4B', '#C95F7D']

const pick = (list, n) => list[Math.abs(n) % list.length]

function Figure({ p, x, n, depth = 0, feet = FEET }) {
  const h = TALLEST * p.height
  const baby = p.group === 'baby'
  const young = p.group === 'youngChild'
  const child = p.group === 'child'
  const teen = p.group === 'teen'
  const adult = p.adult

  const headR = h * (baby ? 0.15 : young ? 0.105 : child ? 0.092 : teen ? 0.085 : 0.08)
  const shoulder = h * (baby ? 0.18 : adult ? (p.female ? 0.205 : 0.225) : teen ? 0.19 : 0.175)
  const bodyTop = -h + headR * 2 + 8
  const bodyBottom = -5
  const cloth = pick(CLOTHES, n * 5 + (p.female ? 2 : 0))
  const skin = pick(SKIN, n + 1)
  const hair = pick(HAIR, n + 1)

  const isDress = p.female && !baby
  const bodyW = isDress ? shoulder * 1.08 : shoulder
  const bodyH = Math.max(28, h * 0.63)

  return (
    <g transform={`translate(${x} ${feet - depth * 4})`} opacity={depth ? 0.97 : 1}>
      {/* soft contact shadow */}
      <ellipse cx="0" cy="2" rx={Math.max(9, shoulder * 1.45)} ry="4.2" fill="#6E3045" opacity="0.16" />

      {/* legs / lower silhouette */}
      {!isDress && !baby && (
        <>
          <path d={`M ${-shoulder * .45} ${bodyBottom - 1} L ${-shoulder * .45} 4`}
            stroke="#65433A" strokeWidth={Math.max(3, h * .035)} strokeLinecap="round" />
          <path d={`M ${shoulder * .45} ${bodyBottom - 1} L ${shoulder * .45} 4`}
            stroke="#65433A" strokeWidth={Math.max(3, h * .035)} strokeLinecap="round" />
          <ellipse cx={-shoulder * .45} cy="5" rx={Math.max(4, shoulder * .35)} ry="2.2" fill="#51342F" />
          <ellipse cx={shoulder * .45} cy="5" rx={Math.max(4, shoulder * .35)} ry="2.2" fill="#51342F" />
        </>
      )}

      {/* body */}
      {isDress ? (
        <path
          d={`M ${-shoulder*.62} ${bodyTop+8}
              Q ${-shoulder*.82} ${bodyTop+22} ${-bodyW} ${bodyBottom}
              H ${bodyW} Q ${shoulder*.82} ${bodyTop+22} ${shoulder*.62} ${bodyTop+8}
              Q ${shoulder*.34} ${bodyTop+2} ${-shoulder*.62} ${bodyTop+8} Z`}
          fill={cloth}
        />
      ) : (
        <rect x={-bodyW} y={bodyTop+8} width={bodyW*2} height={bodyH}
          rx={Math.min(10, bodyW*.35)} fill={cloth} />
      )}

      {/* subtle clothing seam */}
      <path d={`M 0 ${bodyTop+12} V ${bodyBottom-3}`} stroke="#FFF3EA" strokeWidth="1.4" opacity=".24" />

      {/* arms */}
      <path d={`M ${-bodyW*.92} ${bodyTop+17} Q ${-bodyW*1.12} ${bodyTop+35} ${-bodyW*.98} ${bodyBottom-10}`}
        stroke={cloth} strokeWidth={Math.max(4, h*.055)} strokeLinecap="round" fill="none" />
      <path d={`M ${bodyW*.92} ${bodyTop+17} Q ${bodyW*1.12} ${bodyTop+35} ${bodyW*.98} ${bodyBottom-10}`}
        stroke={cloth} strokeWidth={Math.max(4, h*.055)} strokeLinecap="round" fill="none" />
      <circle cx={-bodyW*.98} cy={bodyBottom-9} r={Math.max(2.5,h*.027)} fill={skin} />
      <circle cx={bodyW*.98} cy={bodyBottom-9} r={Math.max(2.5,h*.027)} fill={skin} />

      {/* neck */}
      <rect x={-headR*.32} y={bodyTop-1} width={headR*.64} height={7} rx="2" fill={skin} />

      {/* hair silhouette behind head */}
      {p.female && !baby && (
        <path
          d={`M ${-headR*1.05} ${bodyTop+2}
              Q ${-headR*1.18} ${bodyTop-13} 0 ${bodyTop-17}
              Q ${headR*1.18} ${bodyTop-13} ${headR*1.05} ${bodyTop+2}
              L ${headR*.95} ${bodyTop+30}
              Q 0 ${bodyTop+40} ${-headR*.95} ${bodyTop+30} Z`}
          fill={hair}
        />
      )}

      {/* head */}
      <circle cx="0" cy={bodyTop-3} r={headR} fill={hair} />

      {/* male short-hair side/ear accents */}
      {!p.female && !baby && (
        <>
          <circle cx={-headR*.98} cy={bodyTop} r={headR*.19} fill={skin} />
          <circle cx={headR*.98} cy={bodyTop} r={headR*.19} fill={skin} />
          <path d={`M ${-headR*.8} ${bodyTop-headR*.65} Q 0 ${bodyTop-headR*1.1} ${headR*.8} ${bodyTop-headR*.65}`}
            stroke="#1F1412" strokeWidth={Math.max(1.4, headR*.16)} fill="none" strokeLinecap="round" />
        </>
      )}

      {/* mother/adult female bun; girl bow */}
      {(p.type === 'mother' || p.type === 'adultFemale') && (
        <circle cx="0" cy={bodyTop-headR*1.02} r={headR*.42} fill={hair} />
      )}
      {p.type === 'girl' && !baby && (
        <>
          <circle cx={headR*.82} cy={bodyTop-headR*.55} r={headR*.28} fill="#E98FA9" />
          <circle cx={headR*1.08} cy={bodyTop-headR*.55} r={headR*.28} fill="#D96F91" />
        </>
      )}
    </g>
  )
}

/** A character from an image file: feet on the ground line, scaled to the person's height. */
function ArtFigure({ href, p, x, feet, depth = 0 }) {
  const h = TALLEST * p.height
  const w = h * 0.7
  return (
    <g transform={`translate(${x} ${feet - depth * 4})`}>
      <ellipse cx="0" cy="2" rx={w * 0.4} ry="4" fill="#6E3045" opacity="0.16" />
      <image href={href} x={-w / 2} y={-h} width={w} height={h} preserveAspectRatio="xMidYMax meet" />
    </g>
  )
}

function Heart({ x, y, s=1, o=.35 }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} opacity={o} fill="#D77A93"
    d="M0 3 C-6 -3 -10 2 0 9 C10 2 6 -3 0 3Z" />
}

function Bird({ x, y, s=1 }) {
  return <path d={`M ${x} ${y} q ${4*s} ${-4*s} ${8*s} 0 q ${4*s} ${-4*s} ${8*s} 0`}
    stroke="#A56A7A" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".65" />
}

function Tree({ x, base, s=1, fill='#9BBE91' }) {
  return <g transform={`translate(${x} ${base}) scale(${s})`}>
    <path d="M-3 0 C-4-12 -4-23 0-31 C4-23 4-12 3 0Z" fill="#A86D56" />
    <circle cx="0" cy="-43" r="22" fill={fill} />
    <circle cx="-15" cy="-34" r="14" fill={fill} opacity=".94" />
    <circle cx="15" cy="-34" r="14" fill={fill} opacity=".9" />
  </g>
}

function Flower({ x, y, c }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M0 0V14" stroke="#73966F" strokeWidth="1.7" />
    <circle cx="0" cy="-2" r="3.5" fill={c} />
    <circle cx="0" cy="-2" r="1.1" fill="#FFF3D6" />
  </g>
}

function House() {
  return (
    <g transform="translate(266 205)">
      <rect x="-34" y="-53" width="68" height="53" rx="2" fill="#F8E5D6" />
      <path d="M-43-53L0-88L43-53Z" fill="#A94D62" />
      <rect x="-8" y="-28" width="16" height="28" rx="2" fill="#7A1034" />
      <rect x="-27" y="-43" width="14" height="14" rx="2" fill="#F5CFAF" />
      <rect x="13" y="-43" width="14" height="14" rx="2" fill="#F5CFAF" />
      <circle cx="-20" cy="-36" r="2" fill="#FFF1D8" />
      <circle cx="20" cy="-36" r="2" fill="#FFF1D8" />
    </g>
  )
}

const SCENE_STYLE = {
  sunset: { top:'#FFE9D2', bottom:'#F7CDBE', far:'#F5CBB6', mid:'#E9A9A9', ground:'#D88998' },
  home:   { top:'#FFF0DF', bottom:'#F7D9C9', far:'#F2D0C1', mid:'#E4B1AE', ground:'#D795A1' },
  garden: { top:'#FFF1DF', bottom:'#F7E3D0', far:'#E4D4B4', mid:'#B9D0A9', ground:'#98BE91' },
  park:   { top:'#FFF0DD', bottom:'#F4DCC9', far:'#E5D0B8', mid:'#B8CEAA', ground:'#96BA8E' },
}

function Backdrop({ scene }) {
  if (scene === 'home') {
    return <>
      <House />
      <Tree x={332} base={FEET+4} s={.82} />
      <Bird x={56} y={78} />
      <Bird x={182} y={56} />
      <Heart x={120} y={105} s={.7} />
    </>
  }

  if (scene === 'garden') {
    const colors=['#E58AA3','#F2B84B','#D95F7E','#F5A6B8']
    return <>
      <Tree x={30} base={FEET+4} s={.78} />
      <Tree x={335} base={FEET+4} s={.72} />
      {[24,52,78,302,326,348].map((x,i)=><Flower key={x} x={x} y={FEET-8+(i%2)*7} c={colors[i%4]} />)}
      <circle cx="300" cy="61" r="20" fill="#FFE0A2" opacity=".78" />
      <Heart x={74} y={105} s={.7} /><Heart x={218} y={82} s={.55} />
    </>
  }

  if (scene === 'park') {
    return <>
      <Tree x={34} base={FEET+5} s={1.02} />
      <Tree x={328} base={FEET+5} s={.92} fill="#A7C69D" />
      <path d="M112 83q14-12 28 0q12-8 22 2q-6 8-22 6q-14 6-28-8Z" fill="#fff" opacity=".65" />
      <path d="M235 62q12-10 24 0q10-6 18 2q-6 7-18 5q-12 5-24-7Z" fill="#fff" opacity=".55" />
      <Bird x={188} y={98} />
      <Heart x={82} y={112} s={.65} />
    </>
  }

  return <>
    <circle cx="180" cy="102" r="47" fill="#FFD7A4" opacity=".38" />
    <circle cx="180" cy="102" r="30" fill="#FFC987" opacity=".58" />
    <Bird x={54} y={72} /><Bird x={95} y={54} /><Bird x={287} y={68} />
    <Heart x={42} y={116} s={.75} /><Heart x={320} y={104} s={.62} />
  </>
}

export default function FamilyScene({ members, scene='sunset', style, className }) {
  const look = SCENE_STYLE[scene] || SCENE_STYLE.sunset
  const people = arrange(members)
  const n = people.length
  const back = sceneAsset(scene)
  const front = sceneAsset(scene, 'front')
  // On a backdrop image the ground line is wherever that image puts it.
  const feet = back ? feetFor(scene) * SCENE_H : FEET
  // People of the same kind take the extra looks of their character in turn.
  const seen = {}

  // More compact family grouping than the previous version.
  const centre = scene === 'home' ? 135 : 180
  const usable = scene === 'home' ? 175 : 230
  const step = n > 1 ? Math.min(52, usable / (n - 1)) : 0

  return (
    <svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} width="100%" aria-hidden="true"
      focusable="false" preserveAspectRatio="xMidYMax meet" className={className}
      style={{ display:'block', ...style }}>
      <defs>
        <linearGradient id={`sky-${scene}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.top} />
          <stop offset="1" stopColor={look.bottom} />
        </linearGradient>
        <linearGradient id={`ground-${scene}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.mid} />
          <stop offset="1" stopColor={look.ground} />
        </linearGradient>
      </defs>

      {back ? (
        <image href={back} x="0" y="0" width={SCENE_W} height={SCENE_H} preserveAspectRatio="xMidYMax slice" />
      ) : (
        <>
          <rect width={SCENE_W} height={SCENE_H} fill={`url(#sky-${scene})`} />

          <Backdrop scene={scene} />

          <path d="M0 157Q70 126 150 151T300 143T360 157V300H0Z" fill={look.far} />
          <path d="M0 185Q90 157 190 181T360 176V300H0Z" fill={look.mid} opacity=".92" />
          <path d="M0 218Q90 198 190 218T360 211V300H0Z" fill={`url(#ground-${scene})`} />
        </>
      )}

      {/* Family stands closer together and visually centered. */}
      {people.map((p,i) => {
        const x = n === 1 ? centre : centre - ((n-1)*step)/2 + i*step
        const depth = i === 0 || i === n-1 ? 0 : 1
        const key = characterKey(p)
        const turn = (seen[key] = (seen[key] ?? -1) + 1)
        const href = characterAsset(p, turn)
        return href
          ? <ArtFigure key={i} href={href} p={p} x={x} feet={feet} depth={depth} />
          : <Figure key={i} p={p} n={p.i} depth={depth} x={x} feet={feet} />
      })}

      {front && <image href={front} x="0" y="0" width={SCENE_W} height={SCENE_H} preserveAspectRatio="xMidYMax slice" />}

      {/* foreground soft grass strokes (the vector scene only) */}
      {!back && <path d="M18 245q5-7 10 0m18 3q5-8 10 0m282-2q5-8 10 0m-25 7q5-7 10 0"
        stroke="#6F9B70" strokeWidth="1.6" fill="none" opacity=".42" />}
    </svg>
  )
}
