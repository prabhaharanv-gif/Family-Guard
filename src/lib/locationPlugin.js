import { registerPlugin } from '@capacitor/core'

// Registered once and shared. Lives in its own module so the Supabase client can
// reach the token broker without importing nativeSession, which imports the
// client back.
export const LocationService = registerPlugin('LocationService')
