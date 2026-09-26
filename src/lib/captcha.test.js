import { describe, expect, it } from 'vitest'
import { captchaEnabled, getCaptchaToken, withCaptcha } from './captcha'

// The tests run with no VITE_TURNSTILE_SITE_KEY, which is the state the app
// ships in until CAPTCHA is switched on: it must change nothing at all.
describe('captcha with no site key', () => {
  it('is off', () => {
    expect(captchaEnabled()).toBe(false)
  })

  it('returns no token and loads nothing', async () => {
    expect(await getCaptchaToken()).toBeUndefined()
  })

  it('hands the options back untouched', async () => {
    const opts = { shouldCreateUser: false }
    expect(await withCaptcha(opts)).toEqual({ shouldCreateUser: false })
    expect(await withCaptcha()).toEqual({})
  })
})
