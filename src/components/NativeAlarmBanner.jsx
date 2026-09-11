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

export default function NativeAlarmBanner({
  visible,
  onStop,
  text  = '🚨 SOS alarm is sounding',
  label = '🔕 Stop Alarm',
}) {
  if (!visible) return null
  return (
    <div className="native-alarm-bar">
      <span className="native-alarm-text">{text}</span>
      <button className="native-alarm-btn" onClick={onStop}>
        {label}
      </button>
    </div>
  )
}
