import { useT } from '../i18n'

/**
 * "Add to call": the family members who can still be rung into this call.
 *
 * `people` is already filtered (not me, not already in the call, not already
 * being rung; see addableMembers in lib/conference.js). One tap rings that
 * person into the same call; nothing else to confirm.
 *
 * Sits above the call screen (z-index 800), so it sets its own overlay level
 * rather than the default 100 the other sheets use.
 */
export default function AddToCallSheet({ people, busyId, nameFor, onPick, onClose }) {
  const t = useT()

  return (
    <div className="overlay" style={{ zIndex: 900 }} onClick={onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}
        style={{ padding: '4px 20px max(24px, calc(12px + env(safe-area-inset-bottom, 0px)))' }}>
        <div className="popup-handle" style={{ margin: '9px auto 14px' }} />

        <div style={{
          fontSize: 16, fontWeight: 800, color: 'var(--maroon)', marginBottom: 6,
        }}>
          {t('calls.addToCall')}
        </div>

        {people.length === 0 ? (
          <div style={{ padding: '18px 2px 8px', fontSize: 14, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.5 }}>
            {t('calls.everyoneInCall')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '52vh', overflowY: 'auto' }}>
            {people.map((m, i) => {
              const name = nameFor(m.user_id, m.display_name) || t('messages.member')
              return (
                <button
                  key={m.user_id}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => onPick(m.user_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                    minHeight: 60, padding: '8px 2px', background: 'none', border: 'none',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    cursor: busyId ? 'default' : 'pointer', textAlign: 'left',
                    fontFamily: 'inherit', opacity: busyId && busyId !== m.user_id ? 0.5 : 1,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                    background: 'var(--maroon)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 800,
                  }}>
                    {m.avatar_url
                      ? <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (name[0]?.toUpperCase() || '?')}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {name}
                  </span>
                  <span style={{ color: 'var(--maroon)', flexShrink: 0, opacity: busyId === m.user_id ? 0.45 : 1 }} aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
