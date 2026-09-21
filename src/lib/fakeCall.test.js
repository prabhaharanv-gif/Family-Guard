import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The fake-call bridge must never throw into Profile: every failure resolves
 * to a harmless value, and on anything but Android it does nothing at all.
 */

async function load({ platform = 'android', plugin = {} } = {}) {
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { getPlatform: () => platform },
    registerPlugin: () => plugin,
  }))
  return import('./fakeCall')
}

describe('fakeCall', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.doUnmock('@capacitor/core') })

  it('counts down in whole seconds and never goes negative', async () => {
    const { secondsUntil } = await load()
    expect(secondsUntil(10_000, 0)).toBe(10)
    expect(secondsUntil(10_000, 9_001)).toBe(1)
    expect(secondsUntil(10_000, 10_000)).toBe(0)
    expect(secondsUntil(10_000, 12_000)).toBe(0)
  })

  it('does nothing off Android', async () => {
    const plugin = { schedule: vi.fn(), getSettings: vi.fn() }
    const m = await load({ platform: 'web', plugin })
    expect(await m.getFakeCallSettings()).toBeNull()
    expect(await m.scheduleFakeCall(10)).toBe(false)
    expect(await m.getFakeCallStatus()).toEqual({ state: 'idle', ringAt: 0 })
    expect(plugin.schedule).not.toHaveBeenCalled()
  })

  it('trims name and number and coerces the switches before saving', async () => {
    const plugin = { setSettings: vi.fn(async () => {}) }
    const m = await load({ plugin })
    expect(await m.saveFakeCallSettings({ name: '  Mom ', number: ' 98400 ', voice: 1, notificationButton: undefined })).toBe(true)
    expect(plugin.setSettings).toHaveBeenCalledWith({ name: 'Mom', number: '98400', voice: true, notificationButton: false })
  })

  it('reports failure instead of throwing', async () => {
    const plugin = {
      schedule: vi.fn(async () => { throw new Error('boom') }),
      getSettings: vi.fn(async () => { throw new Error('boom') }),
      getStatus: vi.fn(async () => { throw new Error('boom') }),
      cancel: vi.fn(async () => { throw new Error('boom') }),
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = await load({ plugin })
    expect(await m.scheduleFakeCall(30)).toBe(false)
    expect(await m.getFakeCallSettings()).toBeNull()
    expect(await m.getFakeCallStatus()).toEqual({ state: 'idle', ringAt: 0 })
    await expect(m.cancelFakeCall()).resolves.toBeUndefined()
  })
})
