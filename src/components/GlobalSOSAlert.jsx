/**
 * GlobalSOSAlert
 *
 * Full-screen overlay shown on ANY page when a family member sends an SOS.
 * Includes a link to their location on Google Maps.
 *
 * Once the sender marks themselves safe (alert._resolved, set by useSosAlarm)
 * the same overlay turns green and says so, instead of vanishing — silencing
 * the alarm and the person being safe must never look alike.
 *
 * Extracted from App.jsx.
 */
import { useT } from '../i18n'
import Icon from './Icon'
import NearbySearchMap from './map/NearbySearchMap'
import { SosMediaPlayer } from './SosMedia'
import { helpKindFromMessage, helpNumber } from '../lib/nearbyHelp'

export default function GlobalSOSAlert({ alert, onDismiss }) {
  const t = useT()
  if (!alert) return null
  const memberName = alert._senderName || t('family.aFamilyMember')
  const resolved = !!alert._resolved

  return (
    <div className={resolved ? 'sos-blink-overlay resolved' : 'sos-blink-overlay'} onClick={onDismiss}>
      <div className="sos-alert-banner" onClick={e => e.stopPropagation()}>
        <div className="sos-alert-icon"><Icon name={resolved ? 'shield' : 'siren'} /></div>
        <div className="sos-alert-title">
          {resolved
            ? t('family.safeNow', { name: memberName })
            : <><Icon name="siren" /> {t('family.inTrouble', { name: memberName })}</>}
        </div>
        <div className="sos-alert-sub">
          {alert.message || t('family.sosAlert')}
          {resolved ? (
            <>
              <br />
              <strong>{t('family.sosResolved')}</strong> · {t('family.markedSafe', { name: memberName })}
            </>
          ) : alert.lat !== 0 && alert.lat && (
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
        {/* Famora Social nearby-help status — the same row useSosAlarm reads
            for _resolved above, just a different field on it, so this can
            never show a count out of step with what SOSPage's own status
            card says. Count only, never an identity, per the feature's
            safety boundary. */}
        {!resolved && alert._nearbyHelpStatus === 'helper_found' && (
          <div className="sos-alert-sub" style={{ marginTop: 4 }}>
            <Icon name="users" /> {t('family.nearbyHelping')}
          </div>
        )}
        {!resolved && alert._nearbyHelpStatus === 'exhausted' && (
          <div className="sos-alert-sub" style={{ marginTop: 4 }}>
            {/* Opens the dialer prefilled with the number that matches this SOS — never places the call
                itself. Same window.open(tel:…, '_system') SOSPage uses. */}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.open('tel:' + helpNumber(helpKindFromMessage(alert.message)), '_system') }}
              style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
            >
              <Icon name="phone" /> {t('family.nearbyExhausted', { number: helpNumber(helpKindFromMessage(alert.message)) })}
            </a>
          </div>
        )}
        {/* The sender's voice clip and photos, when they sent any. */}
        {!resolved && (
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', marginBottom: 6 }}>
            <SosMediaPlayer groupId={alert.sos_group_id || alert.id} live />
          </div>
        )}
        {/* Same read-only "is anyone nearby helping?" map SOSPage's own sent
            screen shows — the sender's own position, the ambient opted-in
            dots around them, the searching radar, and the accepted helper's
            fuzzy area once found. Additive reassurance alongside the text
            above, not a replacement for it. */}
        {!resolved && alert._nearbyHelpStatus && (
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', height: 180, borderRadius: 16, overflow: 'hidden', marginTop: 4, marginBottom: 6 }}
          >
            <NearbySearchMap
              lat={alert.lat}
              lng={alert.lng}
              status={alert._nearbyHelpStatus}
              escalationId={alert._nearbyHelpEscalationId}
            />
          </div>
        )}
        <button className="sos-alert-dismiss" onClick={onDismiss}>
          {resolved
            ? t('common.close')
            : <><Icon name="hand" /> {t('family.understandStopAlarm')}</>}
        </button>
      </div>
    </div>
  )
}
