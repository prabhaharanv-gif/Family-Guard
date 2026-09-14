import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Covers the session refresh that runs across app suspend/resume.
 *
 * Two properties matter more than anything else here, and both are about what
 * must NOT happen:
 *
 *   1. It must never sign the user out. Every failure path — offline, server
 *      error, a thrown exception — has to leave the stored session untouched
 *      so the next resume can retry. Getting this wrong is the "app logged me
 *      out after an hour" bug.
 *   2. It must not spend the refresh token while backgrounded. Supabase
 *      rotates refresh tokens on use, so if JS redeems one while the location
 *      service is relying on the same token, whoever goes second is told
 *      "Invalid Refresh Token: Already Used" — and supabase-js treats that as
 *      unrecoverable and erases the session.
 *
 * The module holds state (`initialised`, `appActive`, the periodic timer), so
 * every test imports it fresh.
 */

const FIVE_MIN = 5 * 60 * 1000

/** A session whose token expires in `msFromNow`. */
function sessionExpiringIn(msFromNow) {
  return {
    access_token: 'stored-token',
    refresh_token: 'stored-refresh',
    expires_at: Math.floor((Date.now() + msFromNow) / 1000),
  }
}

/** Wires up the mocks and returns handles for steering them. */
async function load({ session = sessionExpiringIn(60 * 60 * 1000), getSessionError = null } = {}) {
  const state = { session, getSessionError }

  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: state.session },
      error: state.getSessionError,
    })),
    refreshSession: vi.fn(async () => ({
      data: { session: { ...state.session, access_token: 'renewed-token' } },
      error: null,
    })),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
  }

  const adoptNativeSession = vi.fn(async () => false)
  const listeners = {}

  vi.doMock('./supabase', () => ({ supabase: { auth } }))
  vi.doMock('./authDebug', () => ({ authLog: vi.fn(), describeSession: () => ({}) }))
  vi.doMock('./nativeSession', () => ({ adoptNativeSession }))
  vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
  vi.doMock('@capacitor/app', () => ({
    App: {
      addListener: vi.fn((event, cb) => { listeners[event] = cb; return { remove: vi.fn() } }),
    },
  }))

  const mod = await import('./sessionKeepAlive')
  return { mod, auth, adoptNativeSession, listeners, state }
}

describe('sessionKeepAlive', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('./supabase')
    vi.doUnmock('./authDebug')
    vi.doUnmock('./nativeSession')
    vi.doUnmock('@capacitor/core')
    vi.doUnmock('@capacitor/app')
  })

  describe('when the token is healthy', () => {
    it('does not refresh', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(60 * 60 * 1000) })

      const result = await mod.ensureFreshSession('test')

      expect(auth.refreshSession).not.toHaveBeenCalled()
      expect(result.access_token).toBe('stored-token')
    })

    it('treats a token just outside the threshold as healthy', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(FIVE_MIN + 30_000) })

      await mod.ensureFreshSession('test')

      expect(auth.refreshSession).not.toHaveBeenCalled()
    })
  })

  describe('when the token is near or past expiry', () => {
    it('refreshes a token inside the threshold', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(FIVE_MIN - 30_000) })

      const result = await mod.ensureFreshSession('test')

      expect(auth.refreshSession).toHaveBeenCalledTimes(1)
      expect(result.access_token).toBe('renewed-token')
    })

    it('refreshes an already-expired token', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(-60 * 60 * 1000) })

      await mod.ensureFreshSession('test')

      expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    })

    /** A session with no expiry reads as epoch 0, i.e. long expired. */
    it('refreshes when there is no expiry at all', async () => {
      const { mod, auth } = await load({ session: { access_token: 'x', refresh_token: 'y' } })

      await mod.ensureFreshSession('test')

      expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    })
  })

  describe('never signs the user out', () => {
    it('keeps the stored session when the refresh fails and there is nothing to adopt', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(-1000) })
      auth.refreshSession.mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'network unreachable' },
      })

      const result = await mod.ensureFreshSession('test')

      expect(result).not.toBeNull()
      expect(result.access_token).toBe('stored-token')
    })

    it('returns null rather than throwing when getSession errors', async () => {
      const { mod } = await load({ getSessionError: { message: 'storage unavailable' } })

      await expect(mod.ensureFreshSession('test')).resolves.toBeNull()
    })

    it('returns null rather than throwing when there is no session', async () => {
      const { mod } = await load({ session: null })

      await expect(mod.ensureFreshSession('test')).resolves.toBeNull()
    })

    it('swallows an exception instead of propagating it', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(-1000) })
      auth.refreshSession.mockRejectedValueOnce(new Error('boom'))

      await expect(mod.ensureFreshSession('test')).resolves.toBeNull()
    })
  })

  describe('recovering from the native service', () => {
    /**
     * A rejected refresh usually means the location service already renewed
     * natively while the app was closed, revoking our copy. The service holds
     * the live token, so take it rather than treating this as a logout.
     */
    it('adopts the native session when the refresh is rejected', async () => {
      const { mod, auth, adoptNativeSession, state } = await load({
        session: sessionExpiringIn(-1000),
      })
      auth.refreshSession.mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'Invalid Refresh Token: Already Used' },
      })
      adoptNativeSession.mockResolvedValueOnce(true)
      auth.getSession.mockImplementation(async () => {
        state.session = { ...state.session, access_token: 'native-token' }
        return { data: { session: state.session }, error: null }
      })

      const result = await mod.ensureFreshSession('test')

      expect(adoptNativeSession).toHaveBeenCalled()
      expect(result.access_token).toBe('native-token')
    })

    it('does not try to adopt when the refresh succeeded', async () => {
      const { mod, adoptNativeSession } = await load({ session: sessionExpiringIn(-1000) })

      await mod.ensureFreshSession('test')

      expect(adoptNativeSession).not.toHaveBeenCalled()
    })
  })

  /**
   * The rule that stops "Invalid Refresh Token: Already Used". While the app is
   * backgrounded the location service owns the token; spending it here revokes
   * the copy the service is about to use, and supabase-js erases the session
   * when it sees the rejection.
   */
  describe('while backgrounded', () => {
    async function background() {
      const handles = await load({ session: sessionExpiringIn(-1000) })
      handles.mod.initSessionKeepAlive()
      await vi.waitFor(() => expect(handles.listeners.appStateChange).toBeTypeOf('function'))
      handles.auth.refreshSession.mockClear()
      await handles.listeners.appStateChange({ isActive: false })
      return handles
    }

    it('does not spend the refresh token', async () => {
      const { mod, auth } = await background()

      await mod.ensureFreshSession('periodic')

      expect(auth.refreshSession).not.toHaveBeenCalled()
    })

    it('still returns the session rather than nothing', async () => {
      const { mod } = await background()

      const result = await mod.ensureFreshSession('periodic')

      expect(result).not.toBeNull()
      expect(result.access_token).toBe('stored-token')
    })

    it('stops the library auto-refresh too', async () => {
      const { auth } = await background()

      expect(auth.stopAutoRefresh).toHaveBeenCalled()
    })

    it('refreshes again once the app returns to the foreground', async () => {
      const { mod, auth, listeners } = await background()

      await listeners.appStateChange({ isActive: true })
      auth.refreshSession.mockClear()
      await mod.ensureFreshSession('after-resume')

      expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    })
  })

  describe('on resume', () => {
    it('adopts the native session before reclaiming ownership', async () => {
      const { mod, adoptNativeSession, listeners } = await load({
        session: sessionExpiringIn(60 * 60 * 1000),
      })
      mod.initSessionKeepAlive()
      await vi.waitFor(() => expect(listeners.appStateChange).toBeTypeOf('function'))
      adoptNativeSession.mockClear()

      await listeners.appStateChange({ isActive: true })

      expect(adoptNativeSession).toHaveBeenCalledWith('app-resumed')
    })

    it('restarts the library auto-refresh', async () => {
      const { mod, auth, listeners } = await load()
      mod.initSessionKeepAlive()
      await vi.waitFor(() => expect(listeners.appStateChange).toBeTypeOf('function'))

      await listeners.appStateChange({ isActive: true })

      expect(auth.startAutoRefresh).toHaveBeenCalled()
    })
  })

  describe('initialisation', () => {
    it('only wires the lifecycle listeners once', async () => {
      const { mod } = await load()
      const { App } = await import('@capacitor/app')

      mod.initSessionKeepAlive()
      const afterFirst = App.addListener.mock.calls.length
      mod.initSessionKeepAlive()

      expect(App.addListener.mock.calls.length).toBe(afterFirst)
    })

    it('checks the session immediately, for a cold start with an expired token', async () => {
      const { mod, auth } = await load({ session: sessionExpiringIn(-1000) })

      mod.initSessionKeepAlive()
      await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalled())
    })
  })
})
