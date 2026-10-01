import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeBackground } from '../lib/familyBackground'

/**
 * The family's background picture description (see lib/familyBackground.js), shared by
 * every screen that shows or edits it so a save on Profile shows on the Family page at
 * once. Read on its own, not with the family list: if the server has not been given the
 * column yet the read simply fails and the page keeps its plain look, instead of the
 * whole family load failing.
 */

const cache = new Map()        // familyId -> normalized { scene, members } | null
const asked = new Set()
const listeners = new Set()
let version = 0
const bump = () => { version++; listeners.forEach(l => l()) }
const subscribe = l => { listeners.add(l); return () => listeners.delete(l) }
const getVersion = () => version

async function load(familyId) {
  if (!familyId || asked.has(familyId)) return
  asked.add(familyId)
  try {
    const { data, error } = await supabase.from('families').select('background').eq('id', familyId).maybeSingle()
    if (error) { asked.delete(familyId); return }
    cache.set(familyId, normalizeBackground(data?.background))
  } catch {
    asked.delete(familyId)
    return
  }
  bump()
}

/** Save { scene, members } (or null to clear). Throws with .code 'notReady' if the server lacks the feature. */
async function save(familyId, value) {
  const payload = value ? { scene: value.scene, members: value.members } : null
  const { error } = await supabase.rpc('set_family_background', { p_family_id: familyId, p_background: payload })
  if (error) {
    const missing = error.code === 'PGRST202' || /set_family_background/.test(error.message || '')
    const err = new Error(error.message)
    err.code = missing ? 'notReady' : 'failed'
    throw err
  }
  cache.set(familyId, value ? normalizeBackground(value) : null)
  bump()
}

export function useFamilyBackground(familyId) {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  useEffect(() => { load(familyId) }, [familyId])
  return {
    background: familyId ? cache.get(familyId) ?? null : null,
    save: value => save(familyId, value),
  }
}
