import { useBackButton } from '../hooks/useBackButton'
import { VideoIcon } from './CallIcons'

const st = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

/**
 * In-app voice call — a handset with signal arcs, meaning "over the internet".
 * The two call types used to share one 📞 emoji, which made an internet call
 * and a carrier call visually identical.
 */
const AppCallIcon = () => (
  <svg width="17" height="17" {...st}>
    <path d="M13.5 10.5a10 10 0 0 1-9.9-9.9" transform="translate(1.2 6.2)" />
    <path d="M4 3h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 2 5.2 2 2 0 0 1 4 3z" />
    <path d="M16.2 8.4a4.2 4.2 0 0 0-3.4-3.4" />
    <path d="M19.8 8.1A7.8 7.8 0 0 0 13.1 1.4" />
  </svg>
)

/**
 * Display formatting only — never used for the tel: link, which needs the
 * bare digits. Numbers are stored as +91 followed by 10 digits (see
 * AddMemberPage), so anything that does not match that shape is left alone
 * rather than being split at a guessed country-code boundary.
 */
function formatPhone(p) {
  if (!p) return ''
  const m = String(p).trim().match(/^\+91(\d{10})$/)
  return m ? `+91 ${m[1]}` : String(p).trim()
}

/** Carrier call — a dial pad, unmistakably "your phone's own dialler". */
const DialpadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    {[6, 12, 18].map(y => [6, 12, 18].map(x => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" />
    )))}
  </svg>
)

export default function MemberPopup({ member, onClose, onVoiceCall, onVideoCall, isSelf }) {

  useBackButton(true, onClose)

  const digits = member.phone ? member.phone.replace(/[^0-9+]/g, '') : ''
  const hasPhone = digits.length >= 10

  const handleCall = () => {
    if (hasPhone) window.location.href = 'tel:' + digits
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
              {member.relationship && <span>{member.relationship}</span>}
              {member.relationship && hasPhone && <span> · </span>}
              {hasPhone && <span>{formatPhone(member.phone)}</span>}
            </div>
          </div>
        </div>

        {/* Call actions — none of these make sense calling yourself.
            Order: in-app voice/video first, phone-network call last. The
            in-app calls are the app's own feature and are free over data;
            the green button hands off to the dialer and costs call charges,
            so it belongs at the bottom as the fallback. */}
        <div style={{ padding: '4px 0 8px' }}>
          {!isSelf && (
          <>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onVoiceCall}
              style={{
                flex: 1, padding: '14px 12px', borderRadius: 16,
                background: '#ECFDF3', border: '1px solid #16A34A',
                color: '#16A34A', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
              }}
            >
              <AppCallIcon /> Voice
            </button>
            <button
              onClick={onVideoCall}
              style={{
                flex: 1, padding: '14px 12px', borderRadius: 16,
                background: '#F5E6EC', border: '1px solid #951345',
                color: '#951345', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
              }}
            >
              <VideoIcon size={17} /> Video
            </button>
          </div>

          {/* The number IS the label. Showing the actual digits is what makes
              this read as an ordinary phone call, without needing a caption to
              explain the difference from the in-app Voice button above. The
              separate number line underneath is gone — it said the same thing
              twice. */}
          <button
            onClick={handleCall}
            disabled={!hasPhone}
            style={{
              width: '100%', padding: '16px 18px', borderRadius: 16, marginTop: 14,
              background: hasPhone ? '#059669' : '#D1D5DB',
              border: 'none', color: '#fff',
              fontWeight: 800, fontSize: 16, cursor: hasPhone ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', letterSpacing: hasPhone ? 0.3 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: hasPhone ? '0 6px 20px rgba(5,150,105,0.35)' : 'none',
            }}
          >
            <DialpadIcon />
            {hasPhone ? formatPhone(member.phone) : 'No number saved'}
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
