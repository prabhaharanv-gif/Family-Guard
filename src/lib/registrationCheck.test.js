import { describe, expect, it } from 'vitest'
import { isNumberRegistered } from './registrationCheck'

const fakeSupabase = result => ({
  functions: {
    calls: [],
    async invoke(name, opts) { this.calls.push({ name, opts }); return typeof result === 'function' ? result() : result },
  },
})
const token = async () => 'tok-123'

describe('isNumberRegistered', () => {
  it('says true when the function says registered, sending the number and the token', async () => {
    const sb = fakeSupabase({ data: { registered: true }, error: null })
    expect(await isNumberRegistered(sb, '9876543210', token)).toBe(true)
    expect(sb.functions.calls).toEqual([{
      name: 'check-registration',
      opts: { body: { phone: '9876543210', captchaToken: 'tok-123' } },
    }])
  })

  it('says false for a free number', async () => {
    const sb = fakeSupabase({ data: { registered: false }, error: null })
    expect(await isNumberRegistered(sb, '9876543210', token)).toBe(false)
  })

  it('cannot tell without a CAPTCHA token, and does not call the function', async () => {
    const sb = fakeSupabase({ data: { registered: true }, error: null })
    expect(await isNumberRegistered(sb, '9876543210', async () => undefined)).toBeNull()
    expect(sb.functions.calls).toHaveLength(0)
  })

  it('cannot tell when the function errors, so registration carries on', async () => {
    const sb = fakeSupabase({ data: null, error: { message: 'boom' } })
    expect(await isNumberRegistered(sb, '9876543210', token)).toBeNull()
  })

  it('cannot tell when the call throws or the answer is unrecognisable', async () => {
    expect(await isNumberRegistered(fakeSupabase(() => { throw new Error('network') }), '9876543210', token)).toBeNull()
    expect(await isNumberRegistered(fakeSupabase({ data: { unexpected: 1 }, error: null }), '9876543210', token)).toBeNull()
  })
})
