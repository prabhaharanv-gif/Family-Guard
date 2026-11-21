import { describe, it, expect } from 'vitest'
import { siteEventContext } from './siteStats'

const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'

describe('siteEventContext', () => {
  it('reads the three utm keys and ignores everything else', () => {
    const c = siteEventContext('?utm_source=meta&utm_medium=paid&utm_campaign=test2&fbclid=abc&utm_term=x', CHROME_ANDROID)
    expect(c).toEqual({
      p_utm_source: 'meta', p_utm_medium: 'paid', p_utm_campaign: 'test2',
      p_in_app: false, p_platform: 'android',
    })
  })

  it('flags the Facebook / Instagram in-app browser', () => {
    expect(siteEventContext('', FB_ANDROID).p_in_app).toBe(true)
    expect(siteEventContext('', 'Mozilla/5.0 Instagram 300.0 Android').p_in_app).toBe(true)
  })

  it('uses null for missing keys, trims, and limits each value to 80 characters', () => {
    const c = siteEventContext('?utm_source=%20%20&utm_campaign=' + 'x'.repeat(200), '')
    expect(c.p_utm_source).toBeNull()
    expect(c.p_utm_medium).toBeNull()
    expect(c.p_utm_campaign).toBe('x'.repeat(80))
    expect(c.p_platform).toBe('other')
  })

  it('recognises iPhone', () => {
    expect(siteEventContext('', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').p_platform).toBe('ios')
  })
})
