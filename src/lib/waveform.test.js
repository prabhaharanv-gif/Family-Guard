import { describe, it, expect } from 'vitest'
import { waveformBars, BAR_COUNT } from './waveform'

// Real uuids, because the point of the hash is to scatter ids that differ in
// one or two characters — which is what a sequence of them looks like.
const A = '2f1c8e40-6d3a-4b2e-9f01-8c5d7a1e4b33'
const B = '2f1c8e40-6d3a-4b2e-9f01-8c5d7a1e4b34'
const C = '9a0b1c2d-3e4f-5061-7283-94a5b6c7d8e9'

describe('waveformBars', () => {
  it('draws the same shape for the same message, every time', () => {
    // The whole point: a shape that changed between renders, devices or
    // members would read as a glitch rather than a waveform.
    expect(waveformBars(A)).toEqual(waveformBars(A))
  })

  it('separates ids that differ by one character', () => {
    expect(waveformBars(A)).not.toEqual(waveformBars(B))
  })

  it('keeps every bar inside the row', () => {
    for (const id of [A, B, C]) {
      for (const h of waveformBars(id)) {
        expect(h).toBeGreaterThan(0)
        expect(h).toBeLessThanOrEqual(1)
      }
    }
  })

  it('never emits a bar so short it reads as a gap', () => {
    // FLOOR is 0.25 before tapering, and the taper bottoms out at 0.55.
    for (const h of waveformBars(C)) expect(h).toBeGreaterThanOrEqual(0.25 * 0.55)
  })

  it('tapers the ends below the middle', () => {
    const bars = waveformBars(C, 40)
    const edges = [bars[0], bars[bars.length - 1]]
    const mid = bars.slice(10, 30)
    const avgMid = mid.reduce((a, b) => a + b, 0) / mid.length
    for (const e of edges) expect(e).toBeLessThan(avgMid)
  })

  it('returns the asked-for number of bars, and defaults to BAR_COUNT', () => {
    expect(waveformBars(A)).toHaveLength(BAR_COUNT)
    expect(waveformBars(A, 12)).toHaveLength(12)
  })

  it('survives a missing id rather than throwing in a chat row', () => {
    expect(waveformBars(undefined)).toHaveLength(BAR_COUNT)
    expect(waveformBars('')).toHaveLength(BAR_COUNT)
  })
})
