/**
 * NativeAlarmBanner
 *
 * Shown at the top of the screen while a native Android sound is still playing
 * and the app is open — i.e. a push arrived while the app was closed and the
 * user has just reopened it, or it arrived while they were already looking at
 * the app. Either way the noise is owned by a foreground service, so the only
 * other way to stop it is the action on its notification.
 *
 * Two things use it: the SOS siren, and the Find My Phone ring. The Find My
 * Phone case is the one that needed it most — someone hunting for a ringing
 * phone will pick it up and open the app, and until this existed there was
 * nothing there to make it stop.
 *
 * Extracted from App.jsx. The text is a prop so both callers can share the
 * component; the defaults are the original SOS wording.
 */

import Icon from './Icon'
import { useT } from '../i18n'

export default function NativeAlarmBanner({
  visible,
  onStop,
  // Translation keys, not text: the banner shows in the chosen language.
  textKey  = 'alarm.sosSounding',
  labelKey = 'alarm.stopAlarm',
  // Line icons, not emoji — see components/Icon.jsx.
  icon  = 'siren',
  labelIcon = 'bellOff',
  // 'sos' is the SOS red; 'ping' keeps Find My Phone in the brand maroon so
  // the red is never shown for anything but an emergency.
  tone  = 'sos',
}) {
  const t = useT()
  if (!visible) return null
  return (
    <div className={tone === 'ping' ? 'native-alarm-bar ping' : 'native-alarm-bar'}>
      <span className="native-alarm-text"><Icon name={icon} /> {t(textKey)}</span>
      <button className="native-alarm-btn" onClick={onStop}>
        <Icon name={labelIcon} /> {t(labelKey)}
      </button>
    </div>
  )
}
