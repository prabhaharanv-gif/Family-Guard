/**
 * Helpers for the weather sheet (the detail shown when a member's weather chip
 * is tapped). The member-weather function sends moments as UTC milliseconds and
 * the place's offset from UTC in seconds, so every clock reading here is shifted
 * by that offset and read back as UTC: the sheet shows the member's local time
 * wherever the phone happens to be.
 */

/** The five air-quality levels the provider reports (1 good ... 5 very poor). */
export const AQI_KEYS = ['good', 'fair', 'moderate', 'poor', 'veryPoor']

/** i18n key suffix for an air-quality index, or null when unknown. */
export function aqiKey(aqi) {
  const n = Number(aqi)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? AQI_KEYS[n - 1] : null
}

/** "3 PM" / "12 AM" for a moment at a place `tz` seconds east of UTC. */
export function hourText(ts, tz, am, pm) {
  const h = new Date(Number(ts) + Number(tz) * 1000).getUTCHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${h < 12 ? am : pm}`
}

/** Short weekday ("Fri") in the app language for a moment at that place. */
export function dayText(ts, tz, lang) {
  return new Date(Number(ts) + Number(tz) * 1000)
    .toLocaleDateString(lang, { weekday: 'short', timeZone: 'UTC' })
}

/** Compact date ("02 Oct") in the app language for a moment at that place. */
export function dateText(ts, tz, lang) {
  const parts = new Intl.DateTimeFormat(lang, { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(Number(ts) + Number(tz) * 1000))
  const get = (type) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('day')} ${get('month')}`
}

/** Rain chance worth showing: a whole percent, or null when there is none to show. */
export function rainPercent(pop) {
  if (pop == null || pop === '') return null
  const n = Number(pop)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
}

/**
 * The strip of "next hours" an hour apart. The provider only forecasts every 3
 * hours, so the temperature between two forecast steps is read off the straight line
 * between them, while the icon and day/night come from the step that is in force at
 * that moment. The first cell is the current reading itself; the rest fall on whole
 * local hours (`tz` seconds east of UTC) an hour apart, as many as fit within the
 * forecast, up to `count` cells in all.
 */
export function hourlyStrip({ now, nowTs, steps, tz, count = 25 }) {
  const first = { ts: nowTs, temp: now.temp, code: now.code, isDay: now.isDay }
  const future = (steps || []).filter(s => s.ts > nowTs)
  const anchors = [first, ...future]
  const out = [first]
  if (!future.length) return out
  const HOUR = 3600000
  const off = Number(tz) * 1000
  let ts = Math.ceil((nowTs + off) / HOUR) * HOUR - off
  if (ts <= nowTs) ts += HOUR
  const last = anchors[anchors.length - 1].ts
  for (; out.length < count && ts <= last; ts += HOUR) {
    let i = 0
    while (i + 1 < anchors.length && anchors[i + 1].ts <= ts) i++
    const a = anchors[i], b = anchors[i + 1]
    const temp = b ? a.temp + (b.temp - a.temp) * ((ts - a.ts) / (b.ts - a.ts)) : a.temp
    out.push({ ts, temp: Math.round(temp), code: a.code, isDay: a.isDay })
  }
  return out
}
