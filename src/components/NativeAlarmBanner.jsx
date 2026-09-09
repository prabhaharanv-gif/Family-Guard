/**
 * NativeAlarmBanner
 *
 * Shown at the top of the screen when the native Android siren is still
 * sounding — i.e. a push arrived while the app was closed and the user
 * has just reopened it.
 *
 * Extracted from App.jsx.
 */

export default function NativeAlarmBanner({ visible, onStop }) {
  if (!visible) return null
  return (
    <div className="native-alarm-bar">
      <span className="native-alarm-text">🚨 SOS alarm is sounding</span>
      <button className="native-alarm-btn" onClick={onStop}>
        🔕 Stop Alarm
      </button>
    </div>
  )
}
