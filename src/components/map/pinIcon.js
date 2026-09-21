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

function paint(drawAvatar) {
  const size = devicePixels()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  g.scale(size / PIN_SIZE, size / PIN_SIZE)

  const c = PIN_SIZE / 2
  const r = AVATAR / 2

  // White disc with the shadow — the ring the avatar sits inside.
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.25)'
  g.shadowBlur = 8
  g.shadowOffsetY = 2
  g.beginPath()
  g.arc(c, c, r, 0, Math.PI * 2)
  g.fillStyle = '#fff'
  g.fill()
  g.restore()

  // Avatar, clipped to the circle inside the ring.
  g.save()
  g.beginPath()
  g.arc(c, c, r - RING, 0, Math.PI * 2)
  g.clip()
  drawAvatar(g, c, r - RING)
  g.restore()

  return canvas.toDataURL('image/png')
}

/** Coloured disc with the member's initial. Synchronous, so a pin can go up at once. */
export function initialPin(color, initial) {
  return paint((g, c, r) => {
    g.fillStyle = resolveColor(color)
    g.fillRect(c - r, c - r, r * 2, r * 2)
    g.fillStyle = '#fff'
    g.font = '800 18px Inter, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(initial || '?', c, c + 1)
  })
}

const photoCache = new Map()

/**
 * The member's photo, cropped like object-fit: cover. Resolves null when the
 * photo cannot be used — failed to load, or served without CORS headers, which
 * taints the canvas and makes toDataURL throw — so the caller keeps the
 * initial pin rather than showing a broken one.
 */
export function photoPin(url) {
  if (!url) return Promise.resolve(null)
  const key = `${url}@${devicePixels()}`
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
        }))
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
