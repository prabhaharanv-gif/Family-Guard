/**
 * useWeatherDetail
 *
 * The full weather for one place, for the sheet that opens from a member's
 * weather chip: the current reading, the next few hours, the coming days and the
 * air quality. Asks the same member-weather function the card uses, with a
 * `detail` request, so the provider still never sees an exact position (the
 * function rounds to about 11 km) and the key stays on the server.
 *
 * Answers are kept 15 minutes per rounded cell, matching the function's cache,
 * so reopening the sheet does not ask again.
 *
 * Returns { data, loading, failed }. Weather is a courtesy: a failure shows a
 * short message in the sheet and nothing else.
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cellKey } from '../lib/weather'

const TTL_MS = 15 * 60 * 1000
const memo = new Map()   // cellKey -> { at, data }

/** @param point { lat, lng } or null (nothing is fetched while null) */
export function useWeatherDetail(point) {
  const key = point ? cellKey(point.lat, point.lng) : null
  const [state, setState] = useState(() => {
    const hit = key && memo.get(key)
    return hit && Date.now() - hit.at < TTL_MS
      ? { data: hit.data, at: hit.at, loading: false, failed: false }
      : { data: null, at: 0, loading: !!key, failed: false }
  })

  useEffect(() => {
    if (!key) return
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) {
      setState({ data: hit.data, at: hit.at, loading: false, failed: false })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, failed: false }))
    supabase.functions.invoke('member-weather', { body: { detail: { lat: point.lat, lng: point.lng } } })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data?.detail) { setState({ data: null, at: 0, loading: false, failed: true }); return }
        const at = Date.now()
        memo.set(key, { at, data: data.detail })
        setState({ data: data.detail, at, loading: false, failed: false })
      })
      .catch(() => { if (!cancelled) setState({ data: null, at: 0, loading: false, failed: true }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
