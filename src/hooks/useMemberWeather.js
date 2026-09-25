/**
 * useMemberWeather
 *
 * Current weather at each family member's approximate location, for the Family
 * card. Asks the member-weather edge function (which rounds every point to
 * about 11 km before asking OpenWeatherMap) for the members
 * whose position is fresh, and keeps the answers for 15 minutes.
 *
 * Returns { [cellKey]: { temp, code, isDay, gust } }. Look a member up with
 * cellKey(lat, lng) from lib/weather.
 *
 * Weather is decoration: any failure leaves the card without it, silently.
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cellKey } from '../lib/weather'

const TTL_MS = 15 * 60 * 1000   // matches the function's cache; OpenWeatherMap updates ~10 min

// Shared across screens and re-mounts for the life of the page.
const memo = new Map()   // cellKey -> { at, w }

/** @param points [{ lat, lng }] — only members whose position is fresh */
export function useMemberWeather(points) {
  const [weather, setWeather] = useState(() => snapshot())

  // A stable key, so a re-render with the same members does not refetch.
  const cells = [...new Set((points || []).map(p => cellKey(p.lat, p.lng)))].sort()
  const cellsKey = cells.join('|')

  useEffect(() => {
    if (!cells.length) return
    let cancelled = false

    const load = async () => {
      const now = Date.now()
      const stale = cells.filter(k => !memo.has(k) || now - memo.get(k).at > TTL_MS)
      if (stale.length) {
        const points = stale.map(k => { const [lat, lng] = k.split(',').map(Number); return { lat, lng } })
        try {
          const { data, error } = await supabase.functions.invoke('member-weather', { body: { points } })
          if (!error && data?.weather) {
            for (const [k, w] of Object.entries(data.weather)) memo.set(k, { at: Date.now(), w })
          }
        } catch { /* no weather this time */ }
      }
      if (!cancelled) setWeather(snapshot())
    }

    load()
    const timer = setInterval(load, TTL_MS)
    return () => { cancelled = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsKey])

  return weather
}

function snapshot() {
  const out = {}
  for (const [k, v] of memo) out[k] = v.w
  return out
}
