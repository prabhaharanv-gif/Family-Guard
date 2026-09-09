/**
 * GlobalIncomingCall
 *
 * Full-screen ringing overlay shown on ANY page when a family member calls.
 * Mirrors GlobalSOSAlert.jsx's structure, maroon-themed instead of alarm-red.
 */

export default function GlobalIncomingCall({ call, onAccept, onDecline }) {
  if (!call) return null
  const isVideo = call.call_type === 'video'

  return (
    <div className="call-ring-overlay">
      <div className="call-ring-banner">
        <div className="call-ring-avatar">
          {call.callerAvatar
            ? <img src={call.callerAvatar} alt={call.callerName} className="call-ring-avatar-img" />
            : <span>{call.callerName?.[0]?.toUpperCase() || (isVideo ? '📹' : '📞')}</span>}
        </div>
        <div className="call-ring-title">{call.callerName}</div>
        <div className="call-ring-sub">Incoming {isVideo ? 'video' : 'voice'} call…</div>
        <div className="call-ring-actions">
          <button className="call-ring-btn call-ring-decline" onClick={onDecline}>Decline</button>
          <button className="call-ring-btn call-ring-accept" onClick={onAccept}>Accept</button>
        </div>
      </div>
    </div>
  )
}
