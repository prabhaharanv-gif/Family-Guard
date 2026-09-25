import { useState } from 'react'
import { useT } from '../i18n'
import { voiceClipEnabled, setVoiceClipEnabled } from '../lib/sosMedia'
import Dialog from './Dialog'

/**
 * Profile → Voice clip with my SOS.
 *
 * Off unless the member turns it on, and turning it on shows what will be
 * recorded, who can hear it and for how long before anything is saved. Same
 * rule as the other SOS switches: anything that shares a person's surroundings
 * with others must be a choice made in advance, not discovered mid-emergency.
 */
export default function SosVoiceClipCard({ Toggle }) {
  const t = useT()
  const [on, setOn] = useState(voiceClipEnabled())
  const [asking, setAsking] = useState(false)

  const toggle = () => {
    if (on) { setVoiceClipEnabled(false); setOn(false) }
    else setAsking(true)
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('sosMedia.settingTitle')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('sosMedia.settingSub')}
          </div>
        </div>
        <Toggle on={on} onToggle={toggle} />
      </div>

      {asking && (
        <Dialog
          type="confirm"
          title={t('sosMedia.consentTitle')}
          message={t('sosMedia.consentBody')}
          confirmLabel={t('sosMedia.consentOn')}
          onConfirm={() => { setVoiceClipEnabled(true); setOn(true) }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}
