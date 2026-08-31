import { create } from 'zustand'

/**
 * Background-location consent.
 *
 * Google Play's Location Permissions policy requires a *prominent disclosure*
 * that is shown BEFORE any runtime location permission is requested, that
 * names background collection in plain words ("even when the app is closed or
 * not in use"), and that offers a real decline path. The decision is recorded
 * per user id so that signing in as somebody else re-asks.
 *
 * Values: 'granted' | 'declined' | null (never asked)
 */

const KEY_PREFIX = 'bg_location_consent:'

function storageKey(userId) {
  return `${KEY_PREFIX}${userId || 'anonymous'}`
}

function read(userId) {
  try { return localStorage.getItem(storageKey(userId)) } catch { return null }
}

function write(userId, value) {
  try { localStorage.setItem(storageKey(userId), value) } catch { /* private mode */ }
}

export const useLocationConsentStore = create((set) => ({
  userId:  null,
  consent: null,

  /** Load the stored decision for a user. Called when auth state settles. */
  load: (userId) => set({ userId, consent: read(userId) }),

  grant: () => set((s) => {
    write(s.userId, 'granted')
    return { consent: 'granted' }
  }),

  decline: () => set((s) => {
    write(s.userId, 'declined')
    return { consent: 'declined' }
  }),

  /** Used by Profile → Privacy when the user turns location sharing back on. */
  reset: () => set((s) => {
    try { localStorage.removeItem(storageKey(s.userId)) } catch { /* ignore */ }
    return { consent: null }
  }),
}))
