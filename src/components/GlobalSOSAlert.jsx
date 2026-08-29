/**
 * GlobalSOSAlert
 *
 * Full-screen overlay shown on ANY page when a family member sends an SOS.
 * Includes a link to their location on Google Maps.
 *
 * Extracted from App.jsx.
 */

export default function GlobalSOSAlert({ alert, onDismiss }) {
  if (!alert) return null
  const memberName = alert._senderName || 'A family member'

  return (
    <div className="sos-blink-overlay" onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon">🆘</div>
        <div className="sos-alert-title">
          🚨 {memberName} Is In Trouble!
        </div>
        <div className="sos-alert-sub">
          {alert.message || 'SOS Alert'}
          {alert.lat !== 0 && alert.lat && (
            <>
              <br />
              <a
                href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
              >
                📍 View Location on Map
              </a>
            </>
          )}
        </div>
        <button className="sos-alert-dismiss" onClick={onDismiss}>
          ✋ I Understand — Stop Alarm
        </button>
      </div>
    </div>
  )
}
