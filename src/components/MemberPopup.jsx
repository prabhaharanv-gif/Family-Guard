import { useBackButton } from '../hooks/useBackButton'

export default function MemberPopup({ member, onClose }) {

  useBackButton(true, onClose)

  const digits = member.phone ? member.phone.replace(/[^0-9+]/g, '') : ''
  const hasPhone = digits.length >= 10

  const handleCall = () => {
    if (hasPhone) {
      window.location.href = 'tel:' + digits
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
              {hasPhone && <span> · 📱 {member.phone}</span>}
            </div>
          </div>
        </div>

        {/* Call action */}
        <div style={{ padding: '4px 0 8px' }}>
          <button
            onClick={handleCall}
            disabled={!hasPhone}
            style={{
              width: '100%', padding: '16px 18px', borderRadius: 16,
              background: hasPhone ? '#059669' : '#D1D5DB',
              border: 'none', color: '#fff',
              fontWeight: 800, fontSize: 16, cursor: hasPhone ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: hasPhone ? '0 6px 20px rgba(5,150,105,0.35)' : 'none',
            }}
          >
            <span style={{ fontSize: 20 }}>📞</span>
            {hasPhone ? `Call ${member.display_name}` : 'No number saved'}
          </button>

          {hasPhone && (
            <div style={{
              textAlign: 'center', fontSize: 12, color: '#9C6B7A',
              marginTop: 10, fontWeight: 600,
            }}>
              {member.phone}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
