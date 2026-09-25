/**
 * Weather on the Family card: what to draw for a member's current weather.
 *
 * The member-weather function hands back WMO weather codes (it translates
 * OpenWeatherMap's own ids into them). They are folded into the handful of line
 * icons the card can show; the full condition goes to the screen-reader label.
 *
 * "severe" marks the conditions worth a family's attention — heavy rain,
 * thunderstorms, heat, strong gusts — which the card draws in the strong
 * maroon instead of the muted rose. Not red: red on this app means an SOS.
 */

/** Map a WMO code (+ day/night) to an icon name and a condition key. */
export function conditionFor(code, isDay = true) {
  const c = Number(code)
  if (c === 0)                     return { icon: isDay ? 'wSun' : 'wMoon', key: 'clear' }
  if (c === 1 || c === 2)          return { icon: isDay ? 'wCloudSun' : 'wCloudMoon', key: 'partlyCloudy' }
  if (c === 3)                     return { icon: 'wCloud', key: 'cloudy' }
  if (c === 45 || c === 48)        return { icon: 'wFog', key: 'fog' }
  if (c >= 51 && c <= 57)          return { icon: 'wDrizzle', key: 'drizzle' }
  if (c === 65 || c === 67 || c === 82) return { icon: 'wRain', key: 'heavyRain' }
  if ((c >= 61 && c <= 66) || (c >= 80 && c <= 81)) return { icon: 'wRain', key: 'rain' }
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: 'wSnow', key: 'snow' }
  if (c >= 95 && c <= 99)          return { icon: 'wStorm', key: 'thunderstorm' }
  return { icon: 'wCloud', key: 'cloudy' }
}

export const HEAT_C  = 40   // IMD calls 40 C and above a heatwave on the plains
export const GUST_KMH = 60  // strong enough to bring down branches and signage

/**
 * Card data for one reading, or null when there is nothing trustworthy to show.
 * @param w { temp, code, isDay, gust } from the member-weather function
 */
export function weatherView(w) {
  if (!w || !Number.isFinite(Number(w.temp)) || !Number.isFinite(Number(w.code))) return null
  const base = conditionFor(w.code, w.isDay !== false)
  const temp = Math.round(Number(w.temp))
  const heat = temp >= HEAT_C
  const windy = Number(w.gust) >= GUST_KMH
  const stormy = base.key === 'heavyRain' || base.key === 'thunderstorm'
  // Name the reading after its most important part: rain or storm first, then
  // heat on an otherwise fair day, then wind.
  let { icon, key } = base
  if (!stormy && heat && (key === 'clear' || key === 'partlyCloudy')) { icon = 'wHeat'; key = 'heat' }
  else if (!stormy && windy) { icon = 'wWind'; key = 'windy' }
  return { icon, key, temp, severe: stormy || heat || windy }
}

/** The rounded cell the function caches by (0.1 degree, about 11 km). */
export function cellKey(lat, lng) {
  const r = v => (Math.round(Number(v) * 10) / 10).toFixed(1)
  return `${r(lat)},${r(lng)}`
}
