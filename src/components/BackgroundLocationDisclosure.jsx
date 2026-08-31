/**
 * BackgroundLocationDisclosure
 *
 * Google Play requires a "prominent disclosure" shown BEFORE the system
 * background-location prompt — the privacy policy alone does not satisfy it.
 * It has to name the data, say it is collected while the app is closed, and
 * explain what it is used for, with the user able to decline.
 *
 * Rendered by App.jsx and driven by useLocationService, which waits on the
 * user's answer before it calls requestBackgroundPermission().
 */

export default function BackgroundLocationDisclosure({ open, onAccept, onDecline }) {
  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(13,12,29,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: '#fff', borderRadius: 22,
        padding: '28px 24px 22px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.3)',
        fontFamily: 'inherit',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20, margin: '0 auto 18px',
          background: 'linear-gradient(135deg, #FCE7F0, #FFF5F7)',
          border: '1.5px solid #F4B6CE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32,
        }}>
          📍
        </div>

        <div style={{
          fontSize: 19, fontWeight: 800, color: '#0D0C1D',
          fontFamily: 'Sora, sans-serif', textAlign: 'center', marginBottom: 14,
        }}>
          Share location with your family
        </div>

        <div style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.65, marginBottom: 16 }}>
          Famora collects location data to show your position to your family
          group on a shared map, and to include it in SOS alerts —{' '}
          <strong style={{ color: '#0D0C1D' }}>
            even when the app is closed or not in use
          </strong>.
        </div>

        <div style={{
          background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 14,
          padding: '13px 15px', marginBottom: 20,
          fontSize: 13, color: '#4B5563', lineHeight: 1.7,
        }}>
          <div>• Only members of your own family group can see it</div>
          <div>• It is never sold or used for advertising</div>
          <div>• You can turn sharing off at any time in Settings</div>
        </div>

        <button
          onClick={onAccept}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #951345, #720D35)',
            color: '#fff', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(149,19,69,0.35)', marginBottom: 10,
          }}
        >
          Continue
        </button>

        <button
          onClick={onDecline}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 14,
            background: 'none', border: 'none',
            color: '#9C6B7A', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
