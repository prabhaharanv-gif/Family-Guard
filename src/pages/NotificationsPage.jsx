import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useT } from '../i18n'
import {
  TYPE_ICON, URGENT_TYPES, getNotificationLog, markAllSeen,
  clearNotificationLog, groupByDay,
} from '../lib/notificationLog'

/**
 * Family tab -> bell. The last seven days of notifications, newest first, grouped by day.
 * Kept on the phone (see lib/notificationLog.js), so a notification swiped away is still here.
 */
export default function NotificationsPage() {
  const t = useT()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [seenAt, setSeenAt] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    let alive = true
    getNotificationLog().then(async (r) => {
      if (!alive) return
      // Keep the old look-time for the "new" dots; then mark everything as seen.
      setSeenAt(r.seenAt)
      setItems(r.items)
      await markAllSeen()
    })
    return () => { alive = false }
  }, [])

  const groups = useMemo(() => groupByDay(items || []), [items])

  const dayLabel = (g) => {
    if (g.day === 'today') return t('notifLog.today')
    if (g.day === 'yesterday') return t('notifLog.yesterday')
    try {
      return new Date(g.date).toLocaleDateString(t.lang, { weekday: 'short', day: 'numeric', month: 'short' })
    } catch {
      return new Date(g.date).toDateString()
    }
  }

  const timeLabel = (ms) => {
    try {
      return new Date(ms).toLocaleTimeString(t.lang, { hour: 'numeric', minute: '2-digit' })
    } catch {
      return new Date(ms).toLocaleTimeString()
    }
  }

  const clearAll = async () => {
    await clearNotificationLog()
    setItems([])
    setConfirmClear(false)
  }

  const empty = items && items.length === 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
            style={{
              background: '#fff', border: '1px solid #fff',
              borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: 'var(--maroon)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Icon name="arrowLeft" size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="top-bar-title">{t('notifLog.title')}</div>
            <div className="top-bar-sub">{t('notifLog.keptNote')}</div>
          </div>
          {items && items.length > 0 && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              style={{
                background: 'rgba(255,255,255,0.92)', border: '1.5px solid #fff', color: 'var(--maroon)',
                borderRadius: 10, padding: '7px 12px', fontWeight: 800, fontSize: 12,
                fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {t('notifLog.clear')}
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        {confirmClear && (
          <div className="settings-card" style={{ marginBottom: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--maroon)', marginBottom: 10 }}>
              {t('notifLog.clearAsk')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button" onClick={clearAll}
                style={{
                  flex: 1, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
                  background: 'var(--maroon)', color: '#fff', border: '1.5px solid var(--maroon)',
                }}
              >{t('notifLog.clear')}</button>
              <button
                type="button" onClick={() => setConfirmClear(false)}
                style={{
                  flex: 1, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
                  background: '#fff', color: 'var(--maroon)', border: '1.5px solid var(--maroon)',
                }}
              >{t('common.cancel')}</button>
            </div>
          </div>
        )}

        {empty && (
          <div style={{ textAlign: 'center', padding: '56px 24px' }}>
            <div style={{ color: '#C9A3B4', marginBottom: 12 }}><Icon name="inbox" size={40} strokeWidth={1.6} /></div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--maroon)' }}>{t('notifLog.empty')}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
              {t('notifLog.emptySub')}
            </div>
          </div>
        )}

        {groups.map(g => (
          <div key={g.date} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, color: 'var(--muted)', letterSpacing: 0.4,
              textTransform: 'uppercase', margin: '4px 4px 8px',
            }}>
              {dayLabel(g)}
            </div>
            <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
              {g.items.map((it, i) => {
                const urgent = URGENT_TYPES.has(it.type)
                const isNew = it.t > seenAt
                return (
                  <button
                    key={`${it.t}-${i}`}
                    type="button"
                    onClick={() => it.route && navigate(it.route)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left',
                      fontFamily: 'inherit', cursor: it.route ? 'pointer' : 'default',
                      borderTop: i === 0 ? 'none' : '1px solid #F1E3EA',
                    }}
                  >
                    <div style={{ color: urgent ? '#D32F2F' : 'var(--maroon)', marginTop: 2 }}>
                      <Icon name={TYPE_ICON[it.type] || 'bell'} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 800, lineHeight: 1.4,
                        color: urgent ? '#D32F2F' : 'var(--maroon)',
                      }}>
                        {it.title}
                      </div>
                      {it.body && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                          {it.body}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 }}>
                      {isNew && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#D32F2F' }} />}
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{timeLabel(it.t)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
