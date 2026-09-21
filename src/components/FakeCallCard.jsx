import { useState, useEffect, useRef } from 'react'
import {
  FAKE_CALL_DELAYS, getFakeCallSettings, saveFakeCallSettings,
  scheduleFakeCall, cancelFakeCall, getFakeCallStatus, secondsUntil,
} from '../lib/fakeCall'
import { useT } from '../i18n'
import Icon from './Icon'
import Dialog from './Dialog'

/**
 * Profile → Fake call.
 *
 * Who "calls", whether a voice speaks when it is answered, whether the
 * location notification carries a "Call me" button, and the "call me in…"
 * timer. Collapsed by default like Alert Sounds, so it does not push Privacy
 * off the first screen. Renders nothing off Android.
 *
 * Settings save as they change: name and number after a short pause in typing,
 * switches immediately. There is no Save button to forget.
 */
export default function FakeCallCard({ Toggle }) {
  const t = useT()
  const [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState({ state: 'idle', ringAt: 0 })
  const [now, setNow] = useState(() => Date.now())
  const [failed, setFailed] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => { getFakeCallSettings().then(setSettings) }, [])

  // Poll only while a call is scheduled or ringing, to show and end the countdown.
  useEffect(() => {
    if (status.state === 'idle') return
    const id = setInterval(async () => {
      setNow(Date.now())
      setStatus(await getFakeCallStatus())
    }, 1000)
    return () => clearInterval(id)
  }, [status.state])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  if (!settings) return null

  const update = (patch, { debounce = false } = {}) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    clearTimeout(saveTimer.current)
    if (debounce) saveTimer.current = setTimeout(() => saveFakeCallSettings(next), 600)
    else saveFakeCallSettings(next)
  }

  const schedule = async (seconds) => {
    // Flush a pending name/number edit first, so the call shows what was typed.
    clearTimeout(saveTimer.current)
    await saveFakeCallSettings(settings)
    if (!(await scheduleFakeCall(seconds))) { setFailed(true); return }
    setNow(Date.now())
    setStatus(await getFakeCallStatus())
  }

  const cancel = async () => {
    await cancelFakeCall()
    setStatus({ state: 'idle', ringAt: 0 })
  }

  const left = secondsUntil(status.ringAt, now)

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('fakeCall.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('fakeCall.subtitle')}
          </div>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#C9A3B4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <input
            className="input"
            value={settings.name}
            maxLength={40}
            placeholder={t('fakeCall.namePlaceholder')}
            aria-label={t('fakeCall.namePlaceholder')}
            onChange={e => update({ name: e.target.value }, { debounce: true })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={settings.number}
            maxLength={20}
            placeholder={t('fakeCall.numberPlaceholder')}
            aria-label={t('fakeCall.numberPlaceholder')}
            onChange={e => update({ number: e.target.value }, { debounce: true })}
            style={{ marginBottom: 12 }}
          />

          <SettingRow
            label={t('fakeCall.voice')}
            hint={t('fakeCall.voiceHint')}
            control={<Toggle on={settings.voice} onToggle={() => update({ voice: !settings.voice })} />}
          />
          <div style={{ height: 1, background: '#F5EEF2', margin: '10px 0' }} />
          <SettingRow
            label={t('fakeCall.notificationButton')}
            hint={t('fakeCall.notificationButtonHint')}
            control={<Toggle on={settings.notificationButton}
              onToggle={() => update({ notificationButton: !settings.notificationButton })} />}
          />
          <div style={{ height: 1, background: '#F5EEF2', margin: '10px 0 12px' }} />

          {status.state === 'idle' ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                {t('fakeCall.callMeIn')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {FAKE_CALL_DELAYS.map(s => (
                  <button
                    key={s}
                    onClick={() => schedule(s)}
                    style={{
                      flex: 1, background: 'var(--maroon-wash)', border: '1.5px solid #F0D8E3',
                      color: 'var(--maroon)', borderRadius: 10, padding: '10px 0',
                      fontWeight: 800, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    {s < 60 ? t('fakeCall.seconds', { n: s }) : t('fakeCall.minutes', { n: s / 60 })}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="phone" size={18} color="var(--maroon)" />
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {status.state === 'ringing'
                  ? t('fakeCall.ringing')
                  : t('fakeCall.ringsIn', { n: left })}
              </div>
              <button
                onClick={cancel}
                style={{
                  background: 'none', border: '1.5px solid #F0D8E3', color: 'var(--maroon)',
                  borderRadius: 10, padding: '7px 13px', fontWeight: 800, fontSize: 12,
                  fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {failed && (
        <Dialog type="error" title={t('common.error')} message={t('fakeCall.failed')}
          onClose={() => setFailed(false)} />
      )}
    </div>
  )
}

function SettingRow({ label, hint, control }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>
          {hint}
        </div>
      </div>
      {control}
    </div>
  )
}
