import { useMemo } from 'react'
import { useT } from '../../i18n'
import { clockLabel, dateLabel, weekdayLabel, positionAt, silences, stayAt } from '../../lib/route'

/**
 * The Timeline's panel at the foot of the Map: whose history this is, a
 * Route | Times switch, a Last 24 Hours | Last 7 Days switch, and — in
 * Times — a slider across the whole span.
 *
 * Route shows just the line, so the shape of the day reads at a glance.
 * Times adds the member's avatar on the line at the moment picked on the
 * slider: "where were they at 3.40 PM?" answered to the minute, one place at a
 * time, instead of a box every 2 hours piling up where they spent the day.
 *
 * The slider's rail says where there is anything to see: green where their
 * phone was reporting, red where it went quiet for over 10 minutes — the same
 * green and red as the GPS pin on the Family card. (It used to leave the
 * silences blank, which read as part of the background.) The day starts
 * yesterday, so the times carry their date.
 *
 * The page owns the state (mode, picked time) because the map draws from it;
 * this only shows it and reports changes.
 */

// What the ‹ › buttons move, in minutes: finer over a day, coarser over a week.
const STEP_MIN = { '24h': 5, '7d': 30 }
const THUMB = 22            // slider knob, px — the rail is inset by half of it

const maroon = 'var(--maroon)'
// The Family card's GPS pin colours: Live and GPS off.
const GPS_GREEN = '#10B981'
const GPS_RED   = '#DC2626'

export default function TimelinePanel({
  name, route, loading, range, onRange, days, day, onDay, mode, onMode, time, onTime, onClose,
}) {
  const t = useT()
  const am = t('map.am'), pm = t('map.pm')
  const when = ms => `${dateLabel(ms, t.lang)}, ${clockLabel(ms, am, pm)}`
  const ready = !loading && route && route.path.length >= 2

  // The span's extent and the rail's marks, as fractions of it.
  const span = useMemo(() => {
    if (!ready) return null
    const track = route.track
    const start = track[0].t, end = track[track.length - 1].t
    const width = Math.max(end - start, 1)
    const frac = ms => Math.min(Math.max((ms - start) / width, 0), 1)
    const gaps = silences(track).map(g => ({ from: frac(g.from), to: frac(g.to) }))
    return { start, end, minutes: Math.max(Math.round(width / 60000), 1), gaps }
  }, [ready, route])

  // What the picked moment was like: stopped somewhere, moving, or no signal.
  const status = useMemo(() => {
    if (!span || time == null) return ''
    // A time on the picked day reads as just the clock; one on another day
    // (a stay across midnight, a silence since yesterday) carries its date.
    const day0 = dateLabel(time, t.lang)
    const at_ = ms => (dateLabel(ms, t.lang) === day0 ? clockLabel(ms, am, pm) : when(ms))
    const at = positionAt(route.track, time)
    if (at?.gap) return t('map.timelineNoGps', { time: at_(at.lastSeen) })
    const st = stayAt(route.stays, time)
    if (st) return t('map.timelineStayed', { from: at_(st.from), to: at_(st.to) })
    return t('map.timelineMoving')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span, route, time, t.lang])

  const summary = loading
    ? t('map.routeLoading')
    : ready ? t('map.timelineKm', { km: route.km })
    : route?.failed ? t('map.routeFailed') : t('map.routeNone', { name })

  const value = span && time != null ? Math.round((time - span.start) / 60000) : 0
  const setMinutes = m => {
    if (!span) return
    const clamped = Math.min(Math.max(m, 0), span.minutes)
    onTime(clamped === span.minutes ? span.end : span.start + clamped * 60000)
  }

  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 1000,
      background: '#FFF8F0', border: '1.5px solid var(--maroon)', borderRadius: 16,
      boxShadow: '0 4px 16px rgba(74,8,32,0.18)',
      padding: '10px 12px',
    }}>
      {/* Who, how far, the switch, and close. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: maroon,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{summary}</div>
        </div>

        {ready && (
          <Segmented
            label={t('map.todaysRoute')}
            options={[['route', t('map.timelineRoute')], ['times', t('map.timelineTimes')]]}
            value={mode} onChange={onMode}
          />
        )}

        <RoundButton onClick={onClose} label={t('map.routeHide')}>
          <path d="M18 6 6 18M6 6l12 12" />
        </RoundButton>
      </div>

      {/* The span. Shown while loading too, so a slow week can be swapped
          back for the day without waiting. */}
      <div style={{ marginTop: 8 }}>
        <Segmented
          label={t('map.todaysRoute')}
          options={[['24h', t('map.timeline24h')], ['7d', t('map.timeline7d')]]}
          value={range} onChange={onRange} full
        />
      </div>

      {/* Last 7 Days: all of it, or one day. One compact row, no scrolling:
          each day is a small two-line chip, weekday over date, so all eight
          fit a phone. Days with no location at all are greyed and cannot be
          picked. (A dropdown was tried in between and rejected.) */}
      {range === '7d' && days && (
        <div role="radiogroup" aria-label={t('map.timelinePickDay')} style={{
          display: 'flex', gap: 4, marginTop: 8,
        }}>
          <DayChip on={day == null} onClick={() => onDay(null)} label={t('map.timelineAll')} wide>
            <span style={{ fontSize: 12.5, fontWeight: 800 }}>7</span>
            <span style={{ fontSize: 9.5, fontWeight: 700 }}>{t('map.timelineDaysWord')}</span>
          </DayChip>
          {days.map(d => (
            <DayChip key={d.start} on={day === d.start} disabled={!d.has} onClick={() => onDay(d.start)}>
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>{weekdayLabel(d.start, t.lang)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>{new Date(d.start).getDate()}</span>
            </DayChip>
          ))}
        </div>
      )}

      {ready && mode === 'times' && span && (
        <div style={{ marginTop: 10 }}>
          {/* The picked time, what they were doing then, and fine steps. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, lineHeight: 1.15 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: maroon }}>
                  {time != null ? clockLabel(time, am, pm) : ''}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>
                  {time != null ? dateLabel(time, t.lang) : ''}
                </span>
              </div>
              <div style={{
                fontSize: 12.5, fontWeight: 600, color: 'var(--muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{status}</div>
            </div>
            <RoundButton onClick={() => setMinutes(value - STEP_MIN[range])} label={t('map.timelineEarlier')} disabled={value <= 0}>
              <path d="M15 18 9 12l6-6" />
            </RoundButton>
            <RoundButton onClick={() => setMinutes(value + STEP_MIN[range])} label={t('map.timelineLater')} disabled={value >= span.minutes}>
              <path d="m9 18 6-6-6-6" />
            </RoundButton>
          </div>

          {/* The slider. The rail underneath is drawn by hand so it can show
              where GPS was missing; the range input on top only takes the
              finger and draws the knob. */}
          <div style={{ position: 'relative', height: 34, marginTop: 6 }}>
            <div style={{
              position: 'absolute', left: THUMB / 2, right: THUMB / 2, top: 14, height: 6,
              borderRadius: 3, background: GPS_GREEN, overflow: 'hidden',
            }}>
              {span.gaps.map((b, i) => (
                <div key={'g' + i} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${b.from * 100}%`, width: `max(${(b.to - b.from) * 100}%, 2px)`,
                  background: GPS_RED,
                }} />
              ))}
            </div>
            <input
              type="range" className="timeline-range"
              min={0} max={span.minutes} step={1} value={value}
              onChange={e => setMinutes(Number(e.target.value))}
              aria-label={t('map.timelinePick')}
              aria-valuetext={time != null ? when(time) : undefined}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0 }}
            />
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 12, fontWeight: 600, color: 'var(--muted)',
          }}>
            <span>{when(span.start)}</span>
            <span>{when(span.end)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Two or more choices in one maroon-edged bar, the chosen one filled maroon
// (the same control as the map layers' Map | Satellite). full = stretch to
// the panel's width, each choice an equal share.
function Segmented({ label, options, value, onChange, full }) {
  return (
    <div role="radiogroup" aria-label={label} style={{
      display: 'flex', flexShrink: 0,
      border: '1.5px solid var(--maroon)', borderRadius: 10, overflow: 'hidden',
    }}>
      {options.map(([v, text]) => {
        const on = value === v
        return (
          <button key={v} role="radio" aria-checked={on} onClick={() => onChange(v)} style={{
            flex: full ? 1 : undefined,
            padding: full ? '6px 8px' : '7px 12px', border: 'none',
            background: on ? maroon : 'transparent', color: on ? '#FFF8F0' : maroon,
            fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>{text}</button>
        )
      })}
    </div>
  )
}

// One chip in the day row: maroon outline, filled maroon when picked. Days
// share the row equally; the "All" chip (wide) sizes to its word.
function DayChip({ on, disabled, wide, label, onClick, children }) {
  return (
    <button role="radio" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} style={{
      flex: wide ? 'none' : 1, minWidth: 0, height: 36,
      padding: wide ? '0 7px' : 0, borderRadius: 9,
      border: '1.5px solid var(--maroon)',
      background: on ? maroon : 'transparent', color: on ? '#FFF8F0' : maroon,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1.1, fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  )
}

// A 30px round button with a line icon: rose fill, maroon edge.
function RoundButton({ onClick, label, disabled, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
        background: '#F8E6ED', color: maroon, border: '1.5px solid var(--maroon)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}
