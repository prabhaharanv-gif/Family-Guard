import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { getSosTile, setSosTile } from '../lib/nativeSosAlarm'
import Dialog from './Dialog'

/**
 * Profile → SOS tile in Quick Settings.
 *
 * One switch, off unless the member turns it on — the same rule as Shake for
 * SOS: anything that can alert every family must be a choice. Turning it on
 * enables the tile (it ships disabled) and explains, once, what a tap does.
 * Android 13+ also shows the system's own "Add tile?" sheet; older Android has
 * no such API, so the explanation says where to add it by hand.
 */
export default function SosTileCard({ Toggle }) {
  const t = useT()
  const [state, setState] = useState(null)   // { enabled, canPrompt }
  const [explain, setExplain] = useState(false)

  useEffect(() => { getSosTile().then(setState) }, [])

  if (!state) return null

  const toggle = async () => {
    const next = !state.enabled
    setState(s => ({ ...s, enabled: next }))
    try {
      await setSosTile(next)
      if (next) setExplain(true)
    } catch {
      setState(s => ({ ...s, enabled: !next }))
    }
  }

  const message = state.canPrompt
    ? t('sosTile.howItWorks')
    : t('sosTile.howItWorks') + ' ' + t('sosTile.addManually')

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('sosTile.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('sosTile.subtitle')}
          </div>
        </div>
        <Toggle on={state.enabled} onToggle={toggle} />
      </div>

      {explain && (
        <Dialog type="info" title={t('sosTile.title')} message={message}
          onClose={() => setExplain(false)} />
      )}
    </div>
  )
}
