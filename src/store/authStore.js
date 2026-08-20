import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  user: null,
  familyId: null,
  familyName: null,
  inviteCode: null,
  loading: true,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await get().loadFamily(session.user.id)
      set({ user: session.user, loading: false })
    } else {
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await get().loadFamily(session.user.id)
        set({ user: session.user })
      } else {
        set({ user: null, familyId: null, familyName: null, inviteCode: null })
      }
    })
  },

  loadFamily: async (userId) => {
    // Load ALL families the user belongs to
    const { data } = await supabase
      .from('family_members')
      .select('family_id, role, families(id, name, invite_code, created_by)')
      .eq('user_id', userId)

    if (data && data.length > 0) {
      // Prefer the family they JOINED (not created) — i.e. where they are not admin/creator
      // If they only have one, use that one
      // If they have multiple, prefer the one where created_by != userId
      let primary = data.find(d => d.families?.created_by !== userId)
      if (!primary) primary = data[0] // fallback to first if no joined family

      set({
        familyId: primary.family_id,
        familyName: primary.families?.name,
        inviteCode: primary.families?.invite_code,
      })
    }
  },

  createOwnFamily: async (userId, displayName) => {
    const { data: family, error: fe } = await supabase
      .from('families')
      .insert({ name: `${displayName}'s Family`, created_by: userId })
      .select().single()

    if (fe) throw fe

    const { error: me } = await supabase.from('family_members').insert({
      family_id: family.id,
      user_id: userId,
      display_name: displayName,
      role: 'admin',
    })

    if (me) throw me

    set({
      familyId: family.id,
      familyName: family.name,
      inviteCode: family.invite_code,
    })

    return family
  },

  updateFamilyName: async (familyId, newName) => {
    const { error } = await supabase
      .from('families').update({ name: newName }).eq('id', familyId)
    if (!error) set({ familyName: newName })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, familyId: null, familyName: null, inviteCode: null })
  },
}))
