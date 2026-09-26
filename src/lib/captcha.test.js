import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// captcha.js reads VITE_TURNSTILE_SITE_KEY once, when it loads, so each test
// sets the variable first and imports a fresh copy. That keeps these tests
// independent of whatever key the developer has in a local .env.
async function loadWithKey(key) {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', key)
  return import('./captcha')
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllEnvs())

// No key is the state the app ships in until CAPTCHA is switched on: it must
// change nothing at all.
describe('captcha with no site key', () => {
  it('is off', async () => {
    const { captchaEnabled } = await loadWithKey('')
    expect(captchaEnabled()).toBe(false)
  })

  it('returns no token', async () => {
    const { getCaptchaToken } = await loadWithKey('')
    expect(await getCaptchaToken()).toBeUndefined()
  })

  it('hands the options back untouched', async () => {
    const { withCaptcha } = await loadWithKey('')
    expect(await withCaptcha({ shouldCreateUser: false })).toEqual({ shouldCreateUser: false })
    expect(await withCaptcha()).toEqual({})
  })
})

describe('captcha with a site key', () => {
  it('is on', async () => {
    const { captchaEnabled } = await loadWithKey('0xTESTKEY')
    expect(captchaEnabled()).toBe(true)
  })
})
