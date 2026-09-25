import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocationService } from '../lib/locationPlugin'
import { useT } from '../i18n'
import Dialog from './Dialog'

/**
 * Profile → Safety → Crash detection.
 *
 * One switch. Off unless the member turns it on: an automatic trigger that can alert every
 * family must be a choice. Turning it on explains, once, exactly what happens,
 * so nobody is surprised by the countdown. Android only.
 */
export default function CrashDetectionCard({ Toggle }) {
  const t = useT()
  const [enabled, setEnabled] = useState(null)
  const [explain, setExplain] = useState(false)

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    LocationService.getCrashDetect()
      .then(r => setEnabled(!!r?.enabled))
      .catch(() => setEnabled(null))   // older native build without the method
  }, [])

  if (enabled === null) return null

  const toggle = async () => {
    const next = !enabled
    setEnabled(next)
    try {
      await LocationService.setCrashDetect({ enabled: next })
      if (next) setExplain(true)
    } catch {
      setEnabled(!next)
    }
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('crashDetect.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('crashDetect.subtitle')}
          </div>
        </div>
        <Toggle on={enabled} onToggle={toggle} />
      </div>

      {explain && (
        <Dialog type="info" title={t('crashDetect.title')} message={t('crashDetect.howItWorks')}
          onClose={() => setExplain(false)} />
      )}
    </div>
  )
}
