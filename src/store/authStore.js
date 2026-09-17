import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { adoptNativeSession } from '../lib/nativeSession'
import { LocationService } from '../lib/locationPlugin'
import { authLog } from '../lib/authDebug'

export const useAuthStore = create((set, get) => ({
  user:        null,
  familyId:    null,
  familyName:  null,
  inviteCode:  null,
  allFamilies: [],   // [{ family_id, name, invite_code, created_by, role }]
  loading:     true,

  initialize: async () => {
    let { data: { session } } = await supabase.auth.getSession()

    // No session in the WebView does not yet mean signed out. The background
    // location service renews the session natively while the app is closed,
    // and because Supabase rotates refresh tokens that renewal revokes the
    // copy held here — supabase-js then discards it as unusable. The service
    // holds the live one, so ask before showing anyone the login screen.
    if (!session) {
      const adopted = await adoptNativeSession('startup')
      if (adopted) {
        ({ data: { session } } = await supabase.auth.getSession())
      }
    }

    if (session?.user) {
      await get().loadFamily(session.user.id)
      set({ user: session.user, loading: false })
    } else {
      set({ loading: false })
    }
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // TOKEN_REFRESHED fires roughly hourly and hands back a *fresh* user
        // object for the same person. Storing it changes the object identity,
        // which re-runs every effect keyed on `user` — tearing down and
        // re-subscribing the global SOS / incoming-call / device-ping channels.
        // supabase-js already pushes the new token to Realtime itself, so those
        // channels stay authorised without our help. Re-subscribing gains
        // nothing and leaves a brief window where an incoming SOS INSERT can
        // land while no channel is listening, so keep the existing reference.
        //
        // The refresh below still runs: it is the only thing that picks up a
        // family rename or a new membership while the app stays open, since
        // nothing subscribes to the families table. Only the set() is skipped.
        await get().loadFamily(session.user.id)
        if (event === 'TOKEN_REFRESHED' && get().user?.id === session.user.id) return
        set({ user: session.user })
      } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        // Recorded so the next unexplained logout can be traced (__authLog()).
        authLog(`auth-${event}`, { appVisible: typeof document !== 'undefined' ? document.visibilityState : null })
        // Only a real sign-out clears state. This previously cleared on any
        // session-less event, so a transient gap during token renewal could
        // drop the user on the login screen with a usable session in storage.
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
      // Admin families first, then the ones joined as a member, each group
      // alphabetical. Sorted here rather than in the two screens that render
      // this list, so the family switcher and the Profile list cannot disagree
      // about the order.
      const allFamilies = data.map(m => ({
        family_id:  m.family_id,
        name:       m.families?.name || 'Unknown',
        invite_code: m.families?.invite_code,
        created_by: m.families?.created_by,
        role:       m.role,
      })).sort((a, b) => {
        const rank = f => (f.role === 'admin' ? 0 : 1)
        if (rank(a) !== rank(b)) return rank(a) - rank(b)
        return (a.name || '').localeCompare(b.name || '')
      })

      // Pick active family: saved preference → joined family → first
      //
      // Resolved through allFamilies, not through `data`. The query has no
      // ORDER BY, so `data` arrives in whatever order Postgres returns the rows
      // — which is not stable between calls. Both fallbacks below therefore used
      // to be able to pick a different family on two launches of the same
      // install, so somebody in more than one family, with nothing saved yet,
      // could open the app onto either one.
      //
      // allFamilies is already sorted (admin first, then alphabetical), so
      // going through it makes the choice repeatable while keeping the existing
      // preference: a family they joined wins over one they created, because
      // the family somebody was invited into is the one they are usually here
      // for.
      const saved = (typeof localStorage !== 'undefined')
        ? localStorage.getItem('activeFamilyId') : null

      const rowFor = (id) => data.find(m => m.family_id === id)
      const joined = allFamilies.find(f => f.created_by !== userId)

      const membership =
        (saved && rowFor(saved)) ||
        (joined && rowFor(joined.family_id)) ||
        rowFor(allFamilies[0].family_id)

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
      // In no family any more: nothing may stay active, or pages keep querying
      // a family this user was just removed from.
      set({ allFamilies: [], familyId: null, familyName: null, inviteCode: null })
      try { localStorage.removeItem('activeFamilyId') } catch { /* storage unavailable */ }
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
    // SECURE: leave_family RPC — server validates the user can only remove themselves
    // and enforces rules (e.g. owner must transfer before leaving)
    const { error } = await supabase.rpc('leave_family', { p_family_id: familyId })
    if (error) throw error

    // Drop it locally first. Relying on the reload alone left the family in
    // "My Families" and still active when that reload did not land — and a
    // stale activeFamilyId then pointed every page at a family whose members
    // this user can no longer read ("No members yet").
    try {
      if (localStorage.getItem('activeFamilyId') === familyId) localStorage.removeItem('activeFamilyId')
    } catch { /* storage unavailable */ }
    const remaining = get().allFamilies.filter(f => f.family_id !== familyId)
    set({ allFamilies: remaining })
    if (get().familyId === familyId) {
      const next = remaining[0]
      set({ familyId: next?.family_id || null, familyName: next?.name || null, inviteCode: next?.invite_code || null })
    }

    // Then reload from the server, which also picks the right active family.
    await get().loadFamily(userId)
  },

  signOut: async () => {
    // Before auth.signOut(), not after: the RPC resolves the row from
    // auth.uid(), which is gone the moment the session is torn down. Failing
    // to mark is not worth blocking a sign-out over — the family list falls
    // back to showing them as simply offline, which is what it did before.
    try {
      await supabase.rpc('mark_member_signed_out')
    } catch { /* offline, or the migration has not been applied yet */ }

    // Before auth.signOut() as well, and for a harder reason than the RPC: the
    // background service keeps its own copy of the session in SharedPreferences
    // so it can post locations with the app closed. Signing out of the WebView
    // never touched it, so the service carried on holding GPS with a dead token,
    // and BootReceiver — which keys off those stored credentials — restarted it
    // after every reboot. Tracking continued for an account nobody was signed
    // into, and the only way to stop it was to force-stop the app: the privacy
    // toggle that would have stopped it is behind the login.
    //
    // Deliberately not blocking on failure. A native call that throws must not
    // strand somebody in a half-signed-out state.
    if (Capacitor.isNativePlatform()) {
      try {
        await LocationService.clearSession()
      } catch (e) {
        console.warn('[auth] Could not clear the native session:', e?.message)
      }
    }

    await supabase.auth.signOut()
    set({ user: null, familyId: null, familyName: null, inviteCode: null, allFamilies: [] })
  },
}))
