/**
 * GlobalSOSAlert
 *
 * Full-screen overlay shown on ANY page when a family member sends an SOS.
 * Includes a link to their location on Google Maps.
 *
 * Extracted from App.jsx.
 */
import { useT } from '../i18n'
import Icon from './Icon'

export default function GlobalSOSAlert({ alert, onDismiss }) {
  const t = useT()
  if (!alert) return null
  const memberName = alert._senderName || t('family.aFamilyMember')

  return (
    <div className="sos-blink-overlay" onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon"><Icon name="siren" /></div>
        <div className="sos-alert-title">
          <Icon name="siren" /> {t('family.inTrouble', { name: memberName })}
        </div>
        <div className="sos-alert-sub">
          {alert.message || t('family.sosAlert')}
          {alert.lat !== 0 && alert.lat && (
            <>
              <br />
              <a
                href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
              >
                <Icon name="pin" /> {t('family.viewLocation')}
              </a>
            </>
          )}
        </div>
        <button className="sos-alert-dismiss" onClick={onDismiss}>
          <Icon name="hand" /> {t('family.understandStopAlarm')}
        </button>
      </div>
    </div>
  )
}
