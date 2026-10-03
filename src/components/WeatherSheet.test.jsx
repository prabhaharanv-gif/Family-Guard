import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const sample = {
  tz: 19800,
  now: { temp: 32, feels: 36, humidity: 78, windKmh: 14, code: 61, isDay: true, pop: 60, high: 34, low: 25 },
  // Relative to now: a fixed date goes stale and the hourly strip, which only shows
  // hours from now onward, quietly disappears.
  hourly: [0, 1, 2, 3, 4, 5].map(i => ({ ts: Date.now() + i * 3 * 3600e3, temp: 32 - i, code: 3, isDay: i < 3, pop: 10 })),
  daily: [0, 1, 2, 3, 4].map(i => ({ ts: Date.UTC(2026, 9, 2 + i, 6), high: 34, low: 25, code: 61, pop: 40 })),
  aqi: 3,
}

let hookState = { data: sample, at: Date.now(), loading: false, failed: false }
vi.mock('../hooks/useWeatherDetail', () => ({ useWeatherDetail: () => hookState }))
vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }))

const { default: WeatherSheet } = await import('./WeatherSheet')

describe('WeatherSheet', () => {
  it('renders the current reading, the stats and both forecast strips', () => {
    hookState = { data: sample, at: Date.now(), loading: false, failed: false }
    // React puts a comment between adjacent text nodes (32 and the degree sign).
    const html = renderToString(<WeatherSheet name="Joo" lat={11.1} lng={77.3} fresh onClose={() => {}} />).replace(/<!-- -->/g, '')
    expect(html).toContain('32°')
    expect(html).toContain('78%')
    expect(html).toContain('60%')
    expect(html).toContain('Moderate')
    expect(html).toContain('Next hours')
  })

  it('says the weather is for the last known place when the position is old', () => {
    const html = renderToString(<WeatherSheet name="Joo" lat={11.1} lng={77.3} fresh={false} onClose={() => {}} />)
    expect(html).toContain('last known place')
  })

  it('shows a message while loading and when it failed', () => {
    hookState = { data: null, at: 0, loading: true, failed: false }
    expect(renderToString(<WeatherSheet name="Joo" lat={1} lng={1} fresh onClose={() => {}} />)).toContain('Loading weather')
    hookState = { data: null, at: 0, loading: false, failed: true }
    expect(renderToString(<WeatherSheet name="Joo" lat={1} lng={1} fresh onClose={() => {}} />)).toContain('isn&#x27;t available')
  })
})
