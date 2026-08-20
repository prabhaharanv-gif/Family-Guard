export default function MemberPopup({ member, onClose, onViewLocation }) {

  const handleMessage = () => {
    if (member.phone) {
      window.open('https://wa.me/' + member.phone.replace(/[^0-9]/g, ''), '_blank')
    } else {
      alert('No phone number saved for this member.')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}>
        <div className="popup-handle" />

        <div className="popup-header">
          <div className="avatar" style={{
            width: 56, height: 56, fontSize: 22,
            background: member.avatar_color || 'var(--blue)',
            boxShadow: '0 6px 20px ' + (member.avatar_color || 'var(--blue)') + '50',
          }}>
            {member.display_name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="popup-name">{member.display_name}</div>
            <div className="popup-meta">
              {member.relationship && <span>👥 {member.relationship}</span>}
              {member.phone && <span> · 📱 {member.phone}</span>}
              {member.bet_name && <span> · 🏷️ "{member.bet_name}"</span>}
            </div>
          </div>
        </div>

        <div className="popup-actions">
          <button className="action-btn location" onClick={() => onViewLocation(member)}>
            <span className="action-icon">📍</span>
            Location
          </button>
          <button className="action-btn message" onClick={handleMessage}>
            <span className="action-icon">💬</span>
            Message
          </button>
          <button className="action-btn sos" onClick={() => alert('SOS feature — go to SOS tab')}>
            <span className="action-icon">🆘</span>
            SOS Alert
          </button>
        </div>
      </div>
    </div>
  )
}
