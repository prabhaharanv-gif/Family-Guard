import { describe, it, expect } from 'vitest'
import { PLAY_STORE_URL, playStoreUrlFor } from './siteConfig'

const referrerOf = (url) => new URL(url).searchParams.get('referrer')

describe('playStoreUrlFor', () => {
  it('uses the website default when there are no utm parameters', () => {
    expect(playStoreUrlFor('')).toBe(PLAY_STORE_URL)
    expect(playStoreUrlFor('?foo=bar')).toBe(PLAY_STORE_URL)
    expect(referrerOf(PLAY_STORE_URL)).toBe('utm_source=website&utm_medium=landing')
  })

  it('passes the campaign through as the Play install referrer', () => {
    const url = playStoreUrlFor('?utm_source=meta&utm_medium=paid&utm_campaign=reel 1')
    expect(url.startsWith('https://play.google.com/store/apps/details?id=com.scoopfamily.familyguard')).toBe(true)
    expect(referrerOf(url)).toBe('utm_source=meta&utm_medium=paid&utm_campaign=reel%201')
  })

  it('ignores unrelated parameters and limits the length of each value', () => {
    const url = playStoreUrlFor('?fbclid=abc&utm_source=' + 'x'.repeat(200) + '&utm_term=')
    const ref = referrerOf(url)
    expect(ref).toBe('utm_source=' + 'x'.repeat(80))
    expect(ref).not.toContain('fbclid')
  })
})
