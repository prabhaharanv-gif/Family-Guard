import Icon from './Icon'
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

  // Same look as the reliability prompts (SosReliabilitySetup): centred card,
  // tinted disc, benefit-led title, soft green reassurance box, one filled
  // Allow-style button. The Android location dialog that follows is the OS's
  // own and cannot be restyled, so this card is what carries the app's voice.
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(42,10,24,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 22,
    }}>
      <div role="dialog" aria-modal="true" style={{
        width: '100%', maxWidth: 330, background: '#fff', borderRadius: 24,
        padding: '24px 22px 14px', textAlign: 'center', fontFamily: 'inherit',
      }}>
        <div style={{
          width: 68, height: 68, borderRadius: 34, margin: '0 auto 16px',
          background: '#FCE7F0', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--maroon)',
        }}>
          <Icon name="pin" size={32} />
        </div>

        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', lineHeight: 1.25, marginBottom: 8, letterSpacing: -0.2 }}>
          Share location with your family
        </div>

        <div style={{ fontSize: 14.5, color: '#5E3A4B', lineHeight: 1.5, marginBottom: 14 }}>
          Kinest collects location data to show your position to your family
          group on a shared map, and to include it in SOS alerts —{' '}
          <strong style={{ color: 'var(--text)' }}>
            even when the app is closed or not in use
          </strong>.
        </div>

        <div style={{
          background: '#F4F9F6', border: '1px solid #D5EADF', borderRadius: 14,
          padding: '11px 13px', marginBottom: 16, textAlign: 'left',
          fontSize: 13, color: '#2F5D49', lineHeight: 1.6,
        }}>
          <div>• Only members of your own family group can see it</div>
          <div>• They can also see where you have been over the last 7 days</div>
          <div>• It is never sold or used for advertising</div>
          <div>• You can turn sharing off at any time in Settings</div>
        </div>

        <button
          onClick={onAccept}
          style={{
            width: '100%', padding: '14px 10px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
            color: '#fff', fontWeight: 700, fontSize: 16,
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Continue
        </button>

        <button
          onClick={onDecline}
          style={{
            width: '100%', padding: '12px 10px', marginTop: 4,
            background: 'none', border: 'none',
            color: 'var(--maroon)', fontWeight: 600, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
