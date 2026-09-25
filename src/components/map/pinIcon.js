/**
 * Avatar pins for the native Google map, drawn to PNG data URLs.
 *
 * The Leaflet map could use a <div> as a marker. A native map marker is a
 * bitmap, so the same look — round photo or coloured initial, white ring,
 * soft shadow — is painted on a canvas here and handed to the plugin (patched
 * to accept data: URLs; see patches/@capacitor+google-maps+8.0.1.patch).
 *
 * The canvas is exactly PIN_SIZE × devicePixelRatio device pixels. The plugin
 * rescales every icon to that size with nearest-neighbour filtering, so
 * drawing at any other size would come out jagged; at this size the rescale is
 * a no-op and the pin is as sharp as the screen allows.
 */

// Box the pin sits in, in CSS px: the 44px avatar the Leaflet map used, plus a
// margin so its shadow is not clipped by the bitmap's edge.
export const PIN_SIZE = 54
const AVATAR = 44
const RING = 3

function devicePixels() {
  // Same truncation the plugin applies: (size * dpr).toInt()
  return Math.floor(PIN_SIZE * (window.devicePixelRatio || 1))
}

// avatarColor can be a CSS variable ('var(--maroon)'), which a canvas cannot
// resolve on its own.
function resolveColor(color) {
  const fallback = '#8B0D3D'
  if (!color) return fallback
  const m = /^var\((--[^),\s]+)/.exec(color)
  if (!m) return color
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || fallback
}

// Every avatar on the map wears a maroon ring outside its white edge, so it
// stands off the map tiles in the brand colour. ring = null draws the plain
// white-edged pin.
const RING_COLOR = 'var(--maroon)'
function paint(drawAvatar, ring = RING_COLOR) {
  const size = devicePixels()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  g.scale(size / PIN_SIZE, size / PIN_SIZE)

  const c = PIN_SIZE / 2
  const r = AVATAR / 2

  // Outer disc with the shadow: white, or the ring colour with white inside.
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.25)'
  g.shadowBlur = 8
  g.shadowOffsetY = 2
  g.beginPath()
  g.arc(c, c, r, 0, Math.PI * 2)
  g.fillStyle = ring ? resolveColor(ring) : '#fff'
  g.fill()
  g.restore()
  let inner = r - RING
  if (ring) {
    g.beginPath()
    g.arc(c, c, r - RING, 0, Math.PI * 2)
    g.fillStyle = '#fff'
    g.fill()
    inner = r - RING - 2
  }

  // Avatar, clipped to the circle inside the ring.
  g.save()
  g.beginPath()
  g.arc(c, c, inner, 0, Math.PI * 2)
  g.clip()
  drawAvatar(g, c, inner)
  g.restore()

  return canvas.toDataURL('image/png')
}

/** Coloured disc with the member's initial. Synchronous, so a pin can go up at once. */
export function initialPin(color, initial, ring = RING_COLOR) {
  return paint((g, c, r) => {
    g.fillStyle = resolveColor(color)
    g.fillRect(c - r, c - r, r * 2, r * 2)
    g.fillStyle = '#fff'
    g.font = '800 18px Inter, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(initial || '?', c, c + 1)
  }, ring)
}

const photoCache = new Map()

/**
 * The member's photo, cropped like object-fit: cover. Resolves null when the
 * photo cannot be used — failed to load, or served without CORS headers, which
 * taints the canvas and makes toDataURL throw — so the caller keeps the
 * initial pin rather than showing a broken one.
 */
export function photoPin(url, ring = RING_COLOR) {
  if (!url) return Promise.resolve(null)
  const key = `${url}@${devicePixels()}@${ring || ''}`
  if (photoCache.has(key)) return photoCache.get(key)

  const p = new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        resolve(paint((g, c, r) => {
          const side = Math.min(img.naturalWidth, img.naturalHeight)
          const sx = (img.naturalWidth - side) / 2
          const sy = (img.naturalHeight - side) / 2
          g.drawImage(img, sx, sy, side, side, c - r, c - r, r * 2, r * 2)
        }, ring))
      } catch (e) {
        console.warn('[Map] avatar photo unusable as a pin:', e?.message)
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  // A failure is not cached, so a photo that was offline gets another chance.
  p.then(v => { if (v == null) photoCache.delete(key) })
  photoCache.set(key, p)
  return p
}

// ── Callouts on the Timeline ────────────────────────────────────────────────
// A labelled box ("Start 6.12 PM", "Now"), set off the route and joined to its
// point by a thin leader with an arrowhead, so the label never sits on the line
// itself. Boxes that share a spot stack, each with its own leader (a round trip
// puts Start and Now at home). The whole callout is one bitmap whose anchor is
// the route point.
const CALLOUT_FONT = '800 11px Inter, sans-serif'
const BOX_H = 22, BOX_GAP = 5, LEADER = 30, PAD = 3
const calloutCache = new Map()

/**
 * @param labels ['Start 6.12 PM', ...] stacked top to bottom
 * @param dir    unit vector, screen space (y down): where the boxes go
 * @returns { url, width, height, anchorX, anchorY } CSS px
 */
export function timeCallout(labels, dir) {
  const dpr = window.devicePixelRatio || 1
  const key = `${labels.join('|')}@${dir.x.toFixed(2)},${dir.y.toFixed(2)}@${dpr}`
  if (calloutCache.has(key)) return calloutCache.get(key)

  const probe = document.createElement('canvas').getContext('2d')
  probe.font = CALLOUT_FONT
  const boxW = Math.ceil(Math.max(...labels.map(l => probe.measureText(l).width))) + 16
  const stackH = labels.length * BOX_H + (labels.length - 1) * BOX_GAP

  // Centre of the stack, pushed out along dir far enough that the leader has
  // LEADER px of length before it reaches the stack's edge.
  const reach = Math.abs(dir.x) * boxW / 2 + Math.abs(dir.y) * stackH / 2
  const cx = dir.x * (LEADER + reach), cy = dir.y * (LEADER + reach)
  const boxes = labels.map((text, i) => ({
    text,
    x: cx - boxW / 2,
    y: cy - stackH / 2 + i * (BOX_H + BOX_GAP),
  }))

  // Bitmap bounds around the anchor (0,0) and every box.
  const minX = Math.min(0, ...boxes.map(b => b.x)) - PAD
  const minY = Math.min(0, ...boxes.map(b => b.y)) - PAD
  const maxX = Math.max(0, ...boxes.map(b => b.x + boxW)) + PAD
  const maxY = Math.max(0, ...boxes.map(b => b.y + BOX_H)) + PAD
  const W = Math.ceil(maxX - minX), H = Math.ceil(maxY - minY)

  const canvas = document.createElement('canvas')
  // The plugin rescales to (size * dpr) truncated, per side: match it exactly.
  canvas.width = Math.floor(W * dpr)
  canvas.height = Math.floor(H * dpr)
  const g = canvas.getContext('2d')
  g.scale(canvas.width / W, canvas.height / H)
  g.translate(-minX, -minY)
  const maroon = resolveColor('var(--maroon)')

  // Leaders first, so the boxes sit on top of them.
  g.strokeStyle = maroon
  g.fillStyle = maroon
  g.lineWidth = 1.5
  g.lineCap = 'round'
  for (const b of boxes) {
    // End on the box edge that faces the route point.
    const midY = b.y + BOX_H / 2
    const ex = dir.x >= 0 ? b.x : b.x + boxW
    const ey = Math.abs(dir.x) < 0.35 ? (dir.y < 0 ? b.y + BOX_H : b.y) : midY
    const exx = Math.abs(dir.x) < 0.35 ? b.x + boxW / 2 : ex
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(exx, ey)
    g.stroke()
    const a = Math.atan2(ey, exx)
    g.beginPath()
    g.moveTo(exx, ey)
    g.lineTo(exx - 6 * Math.cos(a - 0.45), ey - 6 * Math.sin(a - 0.45))
    g.lineTo(exx - 6 * Math.cos(a + 0.45), ey - 6 * Math.sin(a + 0.45))
    g.closePath()
    g.fill()
  }
  // A small dot on the route point itself.
  g.beginPath()
  g.arc(0, 0, 2.5, 0, Math.PI * 2)
  g.fill()

  g.font = CALLOUT_FONT
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const b of boxes) {
    g.beginPath()
    g.roundRect(b.x, b.y, boxW, BOX_H, 6)
    g.fillStyle = '#FFF8F0'
    g.fill()
    g.lineWidth = 1.5
    g.strokeStyle = maroon
    g.stroke()
    g.fillStyle = maroon
    g.fillText(b.text, b.x + boxW / 2, b.y + BOX_H / 2 + 0.5)
  }

  const out = { url: canvas.toDataURL('image/png'), width: W, height: H, anchorX: -minX, anchorY: -minY }
  calloutCache.set(key, out)
  return out
}

// ── Dots on the Timeline ────────────────────────────────────────────────────
// Three kinds, told apart by shape rather than colour (one maroon throughout):
//   stay  — solid maroon, thin white ring: stayed 15+ minutes here;
//   start — white centre, thick maroon ring: where the 24 h begins;
//   end   — larger solid maroon, white ring: the last place heard from.
export const STAY_DOT = 16
export const END_DOT  = 22
const dotCache = new Map()
function dot(kind, size, draw) {
  const dpr = window.devicePixelRatio || 1
  const key = `${kind}@${dpr}`
  if (dotCache.has(key)) return dotCache.get(key)
  const canvas = document.createElement('canvas')
  // The plugin rescales to (size * dpr) truncated: match it exactly.
  canvas.width = Math.floor(size * dpr)
  canvas.height = Math.floor(size * dpr)
  const g = canvas.getContext('2d')
  g.scale(canvas.width / size, canvas.height / size)
  draw(g, size / 2, resolveColor('var(--maroon)'))
  const url = canvas.toDataURL('image/png')
  dotCache.set(key, url)
  return url
}
const disc = (g, c, r, fill) => { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill() }

export const stayDot = () => dot('stay', STAY_DOT, (g, c, maroon) => {
  disc(g, c, c - 0.5, '#fff'); disc(g, c, c - 3, maroon)
})
export const startDot = () => dot('start', STAY_DOT, (g, c, maroon) => {
  disc(g, c, c - 0.5, maroon); disc(g, c, c - 4.5, '#fff')
})
export const endDot = () => dot('end', END_DOT, (g, c, maroon) => {
  disc(g, c, c - 0.5, '#fff'); disc(g, c, c - 3.5, maroon)
})

// ── Famora Social — ambient dot ─────────────────────────────────────────────
// One shape for every opted-in stranger shown on the nearby-help map: small,
// neutral slate, no initial, no ring. Deliberately NOT the family maroon
// (avatar pins above) or the SOS red (used elsewhere in the app) — this is
// the one pin in the app that must never read as "a person I know" or "an
// active emergency". The colour is hardcoded rather than taking the `maroon`
// argument dot() passes every drawer, for the same reason.
export const ANON_DOT = 16
const ANON_DOT_COLOR = '#8B93A6'
export const anonDot = () => dot('anonSocial', ANON_DOT, (g, c) => {
  disc(g, c, c - 0.5, '#fff'); disc(g, c, c - 3, ANON_DOT_COLOR)
})

// ── Famora Social — accepted helper ─────────────────────────────────────────
// The one dot on the nearby-help map that means "found": the fuzzy area of the
// stranger who accepted, once nearby_help_escalations.status is
// 'helper_found'. Slightly bigger than the ambient dots so it reads as the
// one that matters, and green — the same #10B981 this app already uses for
// "safe" / "resolved" states (see global.css's --emerald and the resolved SOS
// overlay) — so it never gets mistaken for the family maroon or the SOS red.
// Hardcoded for the same reason ANON_DOT_COLOR is: this colour must never
// drift with the `maroon` argument dot() passes every drawer.
export const HELPER_DOT = 20
const HELPER_DOT_COLOR = '#10B981'
export const helperDot = () => dot('helperFound', HELPER_DOT, (g, c) => {
  disc(g, c, c - 0.5, '#fff'); disc(g, c, c - 3.5, HELPER_DOT_COLOR)
})
