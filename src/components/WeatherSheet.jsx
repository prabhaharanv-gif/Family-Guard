import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import { useWeatherDetail } from '../hooks/useWeatherDetail'
import { weatherView, conditionFor } from '../lib/weather'
import { aqiKey, hourText, dayText, rainPercent, dateText, hourlyStrip } from '../lib/weatherDetail'
import Icon from './Icon'

/**
 * WeatherSheet
 *
 * The full weather for one family member, in a sheet that slides up from their
 * weather chip on the Family card: the current reading with how it feels and
 * the day's range, humidity, wind, chance of rain and air quality, then the next
 * few hours and the coming days.
 *
 * The place is a rounded area of about 11 km around the member (the function
 * never sees an exact point). When the member's position is old or their
 * location is off, the sheet says the weather is for their last known place.
 *
 * Soft cream cards on the app's sheet, line icons, no glow.
 */
/**
 * A row of cards that swipes sideways with no scrollbar. Each card is sized so a whole
 * number fit across the row, and the row snaps to a card edge when it comes to rest, so
 * no card is ever left half-hidden.
 */
function SwipeRow({ children }) {
  return (
    <div className="weather-swipe" style={{
      display: 'flex', gap: 6, overflowX: 'auto', overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch',
      scrollSnapType: 'x mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      {children}
    </div>
  )
}

/** The calendar day (as a day count) of a moment at a place `tz` seconds east of UTC. */
const localDay = (ts, tz) => Math.floor((ts + tz * 1000) / 86400000)

export default function WeatherSheet({ name, lat, lng, fresh, self, onClose }) {
  const t = useT()
  useBackButton(true, onClose)
  const { data, at, loading, failed } = useWeatherDetail({ lat, lng })
  // Maroon edges like the member cards, so the boxes read as part of the same app.
  const card = { background: '#fff', border: '1.5px solid var(--maroon)', borderRadius: 14 }
  const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.3, margin: '14px 2px 6px', textTransform: 'uppercase' }
  const message = { padding: '36px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }

  const body = (() => {
    if (loading && !data) return <div style={message}>{t('weather.loading')}</div>
    if (failed || !data) return <div style={message}>{t('weather.unavailable')}</div>

    const n = data.now
    const v = weatherView({ temp: n.temp, code: n.code, isDay: n.isDay, gust: n.windKmh })
    const rain = rainPercent(n.pop)
    // The first cell is the current reading itself, so it matches the big number above;
    // after it come the whole hours of the next 24, an hour apart.
    const hours = hourlyStrip({ now: n, nowTs: at || Date.now(), steps: data.hourly, tz: data.tz, count: 25 })
    const aqi = aqiKey(data.aqi)
    const stat = (icon, value, caption) => (
      <div style={{ ...card, borderRadius: 12, padding: '9px 4px', textAlign: 'center', minWidth: 0 }}>
        <Icon name={icon} size={17} color="var(--maroon)" />
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, lineHeight: 1.2 }}>{caption}</div>
      </div>
    )
    const cell = (key, top, icon, bottom, on, sub, w, tag) => (
      <div key={key} style={{
        ...card, borderRadius: 12, padding: '7px 2px', textAlign: 'center', minWidth: 0,
        ...(w ? { flex: `0 0 ${w}`, scrollSnapAlign: 'start' } : null),
        // The current hour is told apart by its pink fill and a second inner line.
        background: on ? '#FBEFF3' : '#fff', boxShadow: on ? 'inset 0 0 0 1px var(--maroon)' : 'none',
      }}>
        {tag !== undefined && <div style={{ fontSize: 11, height: 14, lineHeight: '14px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 1px', textAlign: 'center' }}>{tag}</div>}
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{top}</div>
        {sub != null && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>{sub}</div>}
        <div style={{ margin: '4px 0' }}><Icon name={icon} size={17} color="var(--maroon)" /></div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{bottom}</div>
      </div>
    )

    return (
      <>
        <div style={{ ...card, borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
          {v && <Icon name={v.icon} size={40} strokeWidth={1.7} color="var(--maroon)" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: 'var(--text)', lineHeight: 1 }}>{n.temp}°</div>
            {v && <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)', marginTop: 4 }}>{t('weather.' + v.key)}</div>}
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
              {t('weather.feels', { n: n.feels })} · {t('weather.highLow', { high: n.high, low: n.low })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginTop: 8 }}>
          {stat('wDrop', `${n.humidity}%`, t('weather.humidity'))}
          {stat('wWind', `${n.windKmh} km/h`, t('weather.wind'))}
          {stat('wUmbrella', rain == null ? '—' : `${rain}%`, t('weather.rain'))}
          {stat('wLeaf', aqi ? t('weather.aqi' + aqi[0].toUpperCase() + aqi.slice(1)) : '—', t('weather.air'))}
        </div>

        {hours.length > 1 && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={label}>{t('weather.nextHours')}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', opacity: 0.8, margin: '14px 2px 6px', whiteSpace: 'nowrap' }}>{t('weather.swipeMore')} ←</div>
            </div>
            <SwipeRow>
              {hours.map((h, i) => {
                // Every card names its day (the Now card says "Weather" instead), so it is clear where today ends.
                const day = localDay(h.ts, data.tz)
                const diff = day - localDay(hours[0].ts, data.tz)
                const tag = i === 0 ? t('weather.weatherWord') : diff <= 0 ? t('weather.today') : diff === 1 ? t('weather.tomorrow') : dayText(h.ts, data.tz, t.lang)
                return cell(h.ts, i === 0 ? t('weather.now') : hourText(h.ts, data.tz, t('map.am'), t('map.pm')), conditionFor(h.code, h.isDay).icon, `${h.temp}°`, i === 0, undefined, 'calc((100% - 24px) / 5)', tag)
              })}
            </SwipeRow>
          </>
        )}

        {data.daily?.length > 0 && (
          <>
            <div style={label}>{t('weather.nextDays')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.daily.length}, minmax(0, 1fr))`, gap: 6 }}>
              {data.daily.map(d => cell(d.ts, dayText(d.ts, data.tz, t.lang), conditionFor(d.code, true).icon, `${d.high}°`, false, dateText(d.ts, data.tz, t.lang)))}
            </div>
          </>
        )}

        {!fresh && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, textAlign: 'center', marginTop: 12 }}>{t(self ? 'weather.lastKnownSelf' : 'weather.lastKnown')}</div>
        )}
      </>
    )
  })()

  const updated = at ? new Date(at).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}
        style={{ background: '#FFF8F0', padding: '4px 16px max(30px, calc(22px + env(safe-area-inset-bottom, 0px)))', maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="popup-handle" style={{ margin: '9px auto 12px' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('weather.title', { name })}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
              {t(self ? 'weather.areaSelf' : 'weather.area')}{updated ? ` · ${t('weather.updated', { time: updated })}` : ''}
            </div>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} style={{
            width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--border)', background: '#fff',
            color: 'var(--muted)', fontSize: 20, lineHeight: '32px', padding: 0, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
          }}>×</button>
        </div>
        {body}
      </div>
    </div>
  )
}
