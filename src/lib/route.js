/**
 * The Timeline on the Map: turning the last 24 h of location_history rows
 * into a line worth drawing, and answering "where were they at 3.40 PM?".
 *
 * A moving phone writes a row every few seconds, so a day can be thousands of
 * points, most of them a few metres apart. Drawing them all is slow on the
 * native map and adds nothing a person can see, so the path is thinned to one
 * point every MIN_STEP_M. A fix that would mean travelling faster than
 * MAX_KMH since the last kept point is a GPS glitch (a Wi-Fi guess across
 * town) and is dropped instead of drawn as a spike.
 *
 * A silence longer than GAP_MS (no signal, or the phone stopped the service)
 * splits the day into segments, and nothing is drawn across the gap: a line
 * there would claim a journey nobody recorded.
 *
 * A STAY is STAY_MS or more within STAY_RADIUS_M of one spot: it gets a dot on
 * the map and a darker stretch on the time slider. The line itself is one
 * solid style throughout — travel used to be dashed, and the dashes read as
 * "a guessed straight line" and confused people (2026-09-22).
 */

/**
 * Where the Timeline's span starts, ms. '24h' is the last 24 hours. '7d' is
 * seven calendar days with today as the 7th: from midnight six days ago. (It
 * was 7 × 24 h, which starts partway through an eighth day and put eight
 * chips in the day row.) location_history keeps 7 × 24 h (retention_job_5),
 * so all of it is still there.
 */
export function timelineSince(range, now = Date.now()) {
  if (range === '7d') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime()
  }
  return now - 24 * 3600000
}
export const MIN_STEP_M  = 20
export const MAX_KMH     = 250
export const GAP_MS      = 10 * 60 * 1000
// A silence only breaks the line when they also moved this far during it: a
// short gap spent nearby is joined up normally, instead of adding a faded
// line beside the real track (reported as "very crowded", 2026-09-22).
export const GAP_MIN_M   = 500
// A hop: two reports too far apart for the straight line between them to be
// the way they went — over HOP_MAX_M, or over HOP_SLOW_M taking more than
// HOP_SLOW_MS. A moving phone reports every few seconds, tens of metres
// apart; a long hop means the reports stopped for a while, and a ruler line
// across town drawn there was mistaken for a road taken (2026-09-22). Nothing
// is drawn across a hop. Unlike a gap it is not "no GPS" on the slider — the
// silence may be short — and the distance still counts: they did get there.
export const HOP_MAX_M   = 1000
export const HOP_SLOW_M  = 300
export const HOP_SLOW_MS = 2 * 60 * 1000
export const STAY_MS       = 15 * 60 * 1000
export const STAY_RADIUS_M = 100

export function distanceM(a, b) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * @param rows [{ lat, lng, recorded_at }] oldest first
 * @returns { path, segments, stays, track, km }
 *   path: every kept point (for framing the camera);
 *   segments: the kept points split at gaps and hops — what the map draws, one line each;
 *   stays: [{ lat, lng, from, to }] — where they stayed STAY_MS or more (ms);
 *   track: [{ lat, lng, t, s }] every believable fix, oldest first, with its
 *     time (ms) and s, which goes up by one at each gap — what the time slider
 *     reads (positionAt, silences);
 *   km: travel, counting hops (straight-line) but not gaps.
 */
export function buildRoute(rows, { minStepM = MIN_STEP_M, maxKmh = MAX_KMH, gapMs = GAP_MS, gapMinM = GAP_MIN_M } = {}) {
  const path = []
  const segments = []
  let seg = null
  let last = null
  let lastT = 0
  let meters = 0
  let s = 0          // gap count so far: fixes either side of a gap differ
  // Every fix that was believable, including the ones too close to draw:
  // a member sitting at home all afternoon is still there at 2 pm.
  const heard = []
  for (const r of rows || []) {
    const lat = Number(r?.lat), lng = Number(r?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
    const p = { lat, lng }
    const t = new Date(r.recorded_at).getTime()
    if (!last) { path.push(p); seg = [p]; segments.push(seg); last = p; lastT = t; heard.push({ ...p, t, s: 0 }); continue }
    const d = distanceM(last, p)
    const gap = t - lastT > gapMs && d > gapMinM
    if (!gap && d < minStepM) { lastT = t; heard.push({ ...p, t, s }); continue }   // still here: time moves on
    const hours = (t - lastT) / 3600000
    if (!gap && hours > 0 && (d / 1000) / hours > maxKmh) continue
    const hop = !gap && (d > HOP_MAX_M || (d > HOP_SLOW_M && t - lastT > HOP_SLOW_MS))
    path.push(p)
    if (gap) s++
    else meters += d
    if (gap || hop) { seg = [p]; segments.push(seg) }
    else seg.push(p)
    heard.push({ ...p, t, s })
    last = p
    lastT = t
  }
  return { path, segments, stays: findStays(heard), track: heard, km: Math.round(meters / 100) / 10 }
}

/** Places they stayed: STAY_MS or longer within STAY_RADIUS_M of where it began. */
export function findStays(heard, { stayMs = STAY_MS, radiusM = STAY_RADIUS_M } = {}) {
  const stays = []
  let i = 0
  while (i < heard.length) {
    let j = i
    while (j + 1 < heard.length && heard[j + 1].s === heard[i].s && distanceM(heard[j + 1], heard[i]) <= radiusM) j++
    if (heard[j].t - heard[i].t >= stayMs) {
      const run = heard.slice(i, j + 1)
      stays.push({
        lat: run.reduce((a, p) => a + p.lat, 0) / run.length,
        lng: run.reduce((a, p) => a + p.lng, 0) / run.length,
        from: heard[i].t, to: heard[j].t,
      })
      i = j + 1
    } else {
      i++
    }
  }
  return stays
}

/**
 * Where they were at time t (ms), for the time slider. Between two fixes the
 * position is interpolated along the straight line joining them — fixes are
 * seconds apart while moving, so the error is a few metres. Inside a silence
 * (see silences) nobody knows: the answer is the last place heard from,
 * flagged gap with the time it was heard.
 * @returns { lat, lng, gap, lastSeen? } or null for an empty track
 */
export function positionAt(track, t, { gapMs = GAP_MS } = {}) {
  if (!track?.length) return null
  const first = track[0], last = track[track.length - 1]
  if (t <= first.t) return { lat: first.lat, lng: first.lng, gap: false }
  if (t >= last.t)  return { lat: last.lat,  lng: last.lng,  gap: false }
  // Largest i with track[i].t <= t.
  let lo = 0, hi = track.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (track[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = track[lo], b = track[hi]
  if (a.s !== b.s || b.t - a.t > gapMs) return { lat: a.lat, lng: a.lng, gap: true, lastSeen: a.t }
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, gap: false }
}

/**
 * Stretches with no location at all: longer than GAP_MS between two fixes.
 * Unlike a line gap this does not ask whether they moved — a phone switched
 * off overnight at home is still hours of "no GPS", and the slider shows it.
 * @returns [{ from, to }] ms
 */
export function silences(track, { gapMs = GAP_MS } = {}) {
  const out = []
  for (let i = 1; i < (track?.length || 0); i++) {
    if (track[i].t - track[i - 1].t > gapMs || track[i].s !== track[i - 1].s) {
      out.push({ from: track[i - 1].t, to: track[i].t })
    }
  }
  return out
}

/** The stay that time t falls in, or null. */
export function stayAt(stays, t) {
  return (stays || []).find(st => t >= st.from && t <= st.to) || null
}

// Date formats per app language: "21 Sep" in English, the month in the
// language's own script elsewhere.
const DATE_LOCALES = { en: 'en-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', hi: 'hi-IN' }

/** "21 Sep" style date from ms, local time, in the app language. */
export function dateLabel(ms, lang = 'en') {
  return new Date(ms).toLocaleDateString(DATE_LOCALES[lang] || 'en-IN', { day: 'numeric', month: 'short' })
}

/**
 * The weekday on a day chip, in the app language: "Sat" in English, the
 * narrow form elsewhere ("ச", "श") — the short Tamil and Malayalam names are
 * too wide for eight chips across a phone. English keeps "Sat": its narrow
 * form is one letter and T, S repeat.
 */
export function weekdayLabel(ms, lang = 'en') {
  return new Date(ms).toLocaleDateString(DATE_LOCALES[lang] || 'en-IN', { weekday: lang === 'en' ? 'short' : 'narrow' })
}

/** Local midnight at the start of the day that ms falls in. */
export function dayStart(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** The start of the next local day (not +24 h: a DST day is 23 or 25 h). */
export function nextDay(dayMs) {
  const d = new Date(dayMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Every local day touching [from, to], as their midnights, oldest first. */
export function daysBetween(from, to) {
  const out = []
  for (let d = dayStart(from); d <= to; d = nextDay(d)) out.push(d)
  return out
}

/** The rows ({ recorded_at }) that fall on the local day starting dayMs. */
export function rowsOnDay(rows, dayMs) {
  const end = nextDay(dayMs)
  return (rows || []).filter(r => {
    const t = new Date(r.recorded_at).getTime()
    return t >= dayMs && t < end
  })
}

/** "3.40 PM" style clock time from ms, local time, using the AM/PM words given. */
export function clockLabel(ms, am = 'AM', pm = 'PM') {
  const d = new Date(ms)
  const hour = d.getHours()
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}.${String(d.getMinutes()).padStart(2, '0')} ${hour < 12 ? am : pm}`
}

/**
 * Which way a callout should point: away from the middle of the route, so the
 * box sits outside the line instead of on it. Screen direction, y down.
 */
export function outwardDir(point, path) {
  const lats = path.map(p => p.lat), lngs = path.map(p => p.lng)
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const x = (point.lng - cLng) * Math.cos(point.lat * Math.PI / 180)
  const y = -(point.lat - cLat)
  const len = Math.hypot(x, y)
  return len > 1e-9 ? { x: x / len, y: y / len } : { x: 0.7071, y: -0.7071 }   // up-right
}
