import { describe, it, expect } from 'vitest'
import { isIndianMobile } from './phone'

describe('isIndianMobile', () => {
  it('accepts ten digits starting with 6-9', () => {
    for (const n of ['6000000000', '7010238538', '8870003970', '9994244044']) {
      expect(isIndianMobile(n)).toBe(true)
    }
  })

  it('rejects a number that starts with 0-5', () => {
    for (const n of ['3698527418', '5025011100', '0123456789', '1234567890']) {
      expect(isIndianMobile(n)).toBe(false)
    }
  })

  it('rejects the wrong length or non-digits', () => {
    for (const n of ['', '987654321', '98765432100', '98765 43210', 'abcdefghij', null, undefined]) {
      expect(isIndianMobile(n)).toBe(false)
    }
  })
})
