import { useState, useEffect, useRef } from 'react'
import { getOfflineSms, saveOfflineSms, sendTestOfflineSms, isOfflineSmsAvailable } from '../lib/offlineSms'
import { useT } from '../i18n'
import Dialog from './Dialog'

/**
 * Profile → Offline SMS alerts.
 *
 * Off unless the member switches it on: these texts cost them money and ring
 * other people's phones. The switch asks Android for the SMS permission, and
 * stays off if it is refused rather than pretending to work.
 *
 * Family admins always receive the alert; the box adds one number of the
 * member's own choosing. Android only.
 */
export default function OfflineSmsCard({ Toggle }) {
  const t = useT()
  const [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(false)
  const [denied, setDenied] = useState(false)
  const [confirmTest, setConfirmTest] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!isOfflineSmsAvailable()) return
    getOfflineSms().then(setSettings)
    return () => clearTimeout(saveTimer.current)
  }, [])

  if (!settings) return null

  const toggle = async () => {
    const next = !settings.enabled
    const { saved } = await saveOfflineSms({ ...settings, enabled: next })
    if (!saved && next) { setDenied(true); return }   // permission refused
    setSettings(s => ({ ...s, enabled: next }))
  }

  const onNumber = (value) => {
    setSettings(s => ({ ...s, extraNumber: value }))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveOfflineSms({ enabled: settings.enabled, extraNumber: value })
    }, 700)
  }

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
            {t('offlineSms.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('offlineSms.subtitle')}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                {t('offlineSms.enable')}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>
                {t('offlineSms.enableHint')}
              </div>
            </div>
            <Toggle on={settings.enabled} onToggle={toggle} />
          </div>

          <input
            className="input"
            type="tel"
            inputMode="tel"
            maxLength={20}
            value={settings.extraNumber}
            placeholder={t('offlineSms.numberPlaceholder')}
            aria-label={t('offlineSms.numberPlaceholder')}
            onChange={e => onNumber(e.target.value)}
          />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            {t('offlineSms.costNote')}
          </div>

          {settings.enabled && (
            <button
              onClick={() => setConfirmTest(true)}
              style={{
                marginTop: 12, width: '100%', background: 'var(--maroon-wash)',
                border: '1.5px solid #F0D8E3', color: 'var(--maroon)', borderRadius: 10,
                padding: '10px 0', fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {t('offlineSms.testButton')}
            </button>
          )}
        </div>
      )}

      {denied && (
        <Dialog type="info" title={t('offlineSms.title')} message={t('offlineSms.permissionNeeded')}
          onClose={() => setDenied(false)} />
      )}

      {/* A test really does text people and really does cost money, so it asks first. */}
      {confirmTest && (
        <Dialog
          type="confirm"
          title={t('offlineSms.testButton')}
          message={t('offlineSms.testConfirm')}
          onConfirm={async () => {
            setConfirmTest(false)
            const sent = await sendTestOfflineSms()
            setTestResult(sent)
          }}
          onClose={() => setConfirmTest(false)}
        />
      )}

      {testResult !== null && (
        <Dialog
          type={testResult > 0 ? 'info' : 'error'}
          title={t('offlineSms.title')}
          message={testResult > 0 ? t('offlineSms.testSent', { n: testResult }) : t('offlineSms.testFailed')}
          onClose={() => setTestResult(null)}
        />
      )}
    </div>
  )
}
