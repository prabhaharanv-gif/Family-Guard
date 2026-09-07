import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { authLog, describeSession } from '../lib/authDebug'

export const useAuthStore = create((set, get) => ({
  user:        null,
  familyId:    null,
  familyName:  null,
  inviteCode:  null,
  allFamilies: [],   // [{ family_id, name, invite_code, created_by, role }]
  loading:     true,
  _initialised: false,

  initialize: async () => {
    // Guard against a second subscription. React StrictMode mounts effects
    // twice in development, and every extra onAuthStateChange listener is one
    // more chance to clobber state.
    if (get()._initialised) return
    set({ _initialised: true })

    const { data: { session } } = await supabase.auth.getSession()
    authLog('startup-getSession', describeSession(session))
    if (session?.user) {
      await get().loadFamily(session.user.id)
      set({ user: session.user, loading: false })
    } else {
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      authLog(`event:${event}`, describeSession(session))
      if (session?.user) {
        await get().loadFamily(session.user.id)
        set({ user: session.user })
        return
      }

      // Only a real sign-out clears local state.
      //
      // This used to clear on ANY event that arrived without a session, which
      // meant a transient event during token renewal could bounce the user to
      // the login screen with a perfectly valid session still in storage.
      // SIGNED_OUT is emitted when the user signs out and when the refresh
      // token is genuinely rejected; everything else is left alone.
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        authLog('CLEARING-USER-STATE', { event })
        set({ user: null, familyId: null, familyName: null, inviteCode: null, allFamilies: [] })
      }
    })
  },

  loadFamily: async (userId) => {
    const { data, error } = await supabase
      .from('family_members')
      .select('family_id, role, families(id, name, invite_code, created_by)')
      .eq('user_id', userId)

    if (error) { console.error('[loadFamily] query failed:', error.message); return }

    if (data && data.length > 0) {
      // Build allFamilies list
      const allFamilies = data.map(m => ({
        family_id:  m.family_id,
        name:       m.families?.name || 'Unknown',
        invite_code: m.families?.invite_code,
        created_by: m.families?.created_by,
        role:       m.role,
      }))

      // Pick active family: saved preference → joined family → first
      const saved = (typeof localStorage !== 'undefined')
        ? localStorage.getItem('activeFamilyId') : null

      const membership =
        (saved && data.find(m => m.family_id === saved)) ||
        data.find(m => m.families && m.families.created_by !== userId) ||
        data[0]

      set({
        allFamilies,
        familyId:   membership.family_id,
        familyName: membership.families?.name,
        inviteCode: membership.families?.invite_code,
      })
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('activeFamilyId', membership.family_id)
      }
    } else {
      set({ allFamilies: [] })
    }
  },

  switchFamily: (familyId) => {
    const { allFamilies } = get()
    const fam = allFamilies.find(f => f.family_id === familyId)
    if (!fam) return
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('activeFamilyId', familyId)
    }
    set({
      familyId:   fam.family_id,
      familyName: fam.name,
      inviteCode: fam.invite_code,
    })
  },

  createOwnFamily: async (_userId, displayName) => {
    const { data: family, error } = await supabase
      .rpc('create_family_with_membership', {
        p_family_name:  `${displayName}'s Family`,
        p_display_name: displayName,
      })

    if (error) throw error

    set({
      familyId:   family.id,
      familyName: family.name,
      inviteCode: family.invite_code,
    })

    return family
  },

  updateFamilyName: async (familyId, newName) => {
    const { error } = await supabase
      .rpc('update_family_name', {
        p_family_id: familyId,
        p_new_name:  newName,
      })

    if (error) throw error
    set({ familyName: newName })
  },

  leaveFamily: async (userId, familyId) => {
    const { error } = await supabase
      .from('family_members')
      .delete()
      .eq('user_id', userId)
      .eq('family_id', familyId)
    if (error) throw error

    // Reload all families and switch to another one
    await get().loadFamily(userId)
  },

  signOut: async () => {
    authLog('user-tapped-signout')
    await supabase.auth.signOut()
    set({ user: null, familyId: null, familyName: null, inviteCode: null, allFamilies: [] })
  },
}))
