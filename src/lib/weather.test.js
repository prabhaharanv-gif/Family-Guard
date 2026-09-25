import { describe, it, expect } from 'vitest'
import { conditionFor, weatherView, cellKey, HEAT_C, GUST_KMH } from './weather'

describe('conditionFor', () => {
  it('clear sky is sun by day, moon by night', () => {
    expect(conditionFor(0, true)).toEqual({ icon: 'wSun', key: 'clear' })
    expect(conditionFor(0, false)).toEqual({ icon: 'wMoon', key: 'clear' })
  })
  it('groups the WMO families', () => {
    expect(conditionFor(2).key).toBe('partlyCloudy')
    expect(conditionFor(3).key).toBe('cloudy')
    expect(conditionFor(45).key).toBe('fog')
    expect(conditionFor(53).key).toBe('drizzle')
    expect(conditionFor(61).key).toBe('rain')
    expect(conditionFor(80).key).toBe('rain')
    expect(conditionFor(73).key).toBe('snow')
    expect(conditionFor(96).key).toBe('thunderstorm')
  })
  it('the heavy codes are heavy rain, not plain rain', () => {
    for (const c of [65, 67, 82]) expect(conditionFor(c).key).toBe('heavyRain')
  })
  it('an unknown code falls back to cloudy rather than nothing', () => {
    expect(conditionFor(42).key).toBe('cloudy')
  })
})

describe('weatherView', () => {
  it('rounds the temperature and marks ordinary weather not severe', () => {
    expect(weatherView({ temp: 29.6, code: 3, isDay: true, gust: 10 }))
      .toEqual({ icon: 'wCloud', key: 'cloudy', temp: 30, severe: false })
  })
  it('heavy rain and storms are severe', () => {
    expect(weatherView({ temp: 25, code: 65, isDay: true, gust: 0 }).severe).toBe(true)
    expect(weatherView({ temp: 25, code: 95, isDay: true, gust: 0 }).severe).toBe(true)
  })
  it('heat on a clear day becomes a heat reading', () => {
    const v = weatherView({ temp: HEAT_C, code: 0, isDay: true, gust: 0 })
    expect(v).toMatchObject({ icon: 'wHeat', key: 'heat', severe: true })
  })
  it('just under the heat line is ordinary', () => {
    expect(weatherView({ temp: HEAT_C - 1, code: 0, isDay: true, gust: 0 }).severe).toBe(false)
  })
  it('strong gusts are severe and named windy', () => {
    const v = weatherView({ temp: 28, code: 3, isDay: true, gust: GUST_KMH })
    expect(v).toMatchObject({ icon: 'wWind', key: 'windy', severe: true })
  })
  it('a storm keeps its own name even when it is also windy', () => {
    expect(weatherView({ temp: 28, code: 95, isDay: true, gust: 90 }).key).toBe('thunderstorm')
  })
  it('missing or broken readings show nothing', () => {
    expect(weatherView(null)).toBeNull()
    expect(weatherView({ temp: 'x', code: 3 })).toBeNull()
    expect(weatherView({ temp: 30 })).toBeNull()
  })
})

describe('cellKey', () => {
  it('rounds to 0.1 degree, the same cells the function caches by', () => {
    expect(cellKey(11.1558, 77.3101)).toBe('11.2,77.3')
    expect(cellKey(-0.04, 0.04)).toBe('0.0,0.0')  // -0 prints as 0.0, same in the function
  })
})
