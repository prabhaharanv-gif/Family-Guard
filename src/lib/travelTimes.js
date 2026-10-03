import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { arrivalTextAt } from './eta'

// Real travel time and road distance to each family member, from Google Maps via the
// travel-times edge function. Nothing is estimated from a straight line: a mode shows
// up for a member only when Google found a route for it, so someone with no bus service
// has no bus icon. There is no flight (Google has none to give).
//
// Answers are kept per (member, my spot, their spot) on the same 0.002 degree grid the
// function uses, for 8 minutes, so a re-render never asks again and a short drift in
// GPS does not either. A failed lookup is remembered for 2 minutes only: "could not
// ask" must not be mistaken for "no bus".

// While false the app never asks Google: every distance is the straight line and every
// arrival a rough "~" estimate. Switched off 2026-10-01 because the Routes API quota was
// being exceeded (HTTP 429). Set true again once the quota is raised.
const USE_GOOGLE = false

const GRID     = 0.002
const TTL_MS   = 8 * 60 * 1000
const ERR_TTL  = 2 * 60 * 1000
const MAX_TARGETS = 10

/** Modes in the order they are offered, and the order of preference for the default. */
export const MODES = ['car', 'bus', 'train', 'walk']

const snap = v => (Math.round(v / GRID) * GRID).toFixed(3)
const keyFor = (id, o, t) => `${id}|${snap(o.lat)},${snap(o.lng)}|${snap(t.lat)},${snap(t.lng)}`

const memo      = new Map()   // key -> { at, ok, times }   times: { car?, bus?, ... }
const pending   = new Set()
const choice    = new Map()   // member id -> the mode the person tapped
const listeners = new Set()
let version = 0
const bump = () => { version++; listeners.forEach(l => l()) }
const subscribe = l => { listeners.add(l); return () => listeners.delete(l) }
const getVersion = () => version

const okPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)

async function refresh(origin, targets) {
  const now = Date.now()
  const stale = targets.filter(t => {
    const k = keyFor(t.id, origin, t)
    const hit = memo.get(k)
    return !pending.has(k) && (!hit || now - hit.at > (hit.ok ? TTL_MS : ERR_TTL))
  })
  if (!stale.length) return
  const keys = stale.map(t => keyFor(t.id, origin, t))
  keys.forEach(k => pending.add(k))
  try {
    const { data, error } = await supabase.functions.invoke('travel-times', {
      body: { origin: { lat: origin.lat, lng: origin.lng }, targets: stale.map(t => ({ id: t.id, lat: t.lat, lng: t.lng })) },
    })
    stale.forEach((t, i) => {
      const r = !error ? data?.times?.[t.id] : null
      // r.error: at least one lookup failed, so the answer may be missing modes.
      memo.set(keys[i], { at: Date.now(), ok: !!r && !r.error, times: r || {} })
    })
  } catch {
    stale.forEach((t, i) => memo.set(keys[i], { at: Date.now(), ok: false, times: {} }))
  } finally {
    keys.forEach(k => pending.delete(k))
    bump()
  }
}

/**
 * @param origin  my position { lat, lng } or null
 * @param targets [{ id, lat, lng }] — the members to look up (not me)
 * @returns { for(id), setMode(id, mode) }
 *   for(id) is null until Google has answered, or when it could not. Otherwise:
 *   { modes: ['car','bus',...] (only real routes), mode, km, minutes, arriveAt (ms) }
 *   modes is empty when Google knows no route there (another continent, say).
 */
export function useTravelTimes(origin, targets) {
  useSyncExternalStore(subscribe, getVersion, getVersion)

  const list = useMemo(() => (targets || []).filter(okPoint).slice(0, MAX_TARGETS), [targets])
  const sig = okPoint(origin)
    ? `${snap(origin.lat)},${snap(origin.lng)}|` + list.map(t => keyFor(t.id, origin, t)).join(';')
    : ''

  useEffect(() => {
    if (!USE_GOOGLE || !sig) return
    refresh(origin, list)
    const timer = setInterval(() => refresh(origin, list), TTL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const forMember = id => {
    const t = list.find(x => x.id === id)
    if (!t || !okPoint(origin)) return null
    const hit = memo.get(keyFor(id, origin, t))
    if (!hit || !hit.ok) return null
    const modes = MODES.filter(m => hit.times[m])
    if (!modes.length) return { modes: [], mode: null, km: null, minutes: null, arriveAt: null }
    const wanted = choice.get(id)
    const mode = modes.includes(wanted) ? wanted : modes[0]
    const leg = hit.times[mode]
    // Transit may have to wait for the first vehicle; the answer stays right while cached.
    const start = Math.max(Date.now(), leg.departAt ? Date.parse(leg.departAt) : 0)
    return { modes, mode, km: leg.km, minutes: leg.minutes, arriveAt: start + leg.minutes * 60000 }
  }

  return { for: forMember, setMode: (id, mode) => { choice.set(id, mode); bump() } }
}

/** "Reach by" text for a result from for(id): the time today, the date and time otherwise. */
export const arrivalLabel = r => (r?.arriveAt ? arrivalTextAt(r.arriveAt) : null)
