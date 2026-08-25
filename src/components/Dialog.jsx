import { useEffect, useRef } from 'react'

/**
 * In-app replacement for alert() and window.confirm().
 *
 * Usage — alert:
 *   <Dialog type="alert" message="Copied!" onClose={() => setDialog(null)} />
 *
 * Usage — confirm:
 *   <Dialog type="confirm" message="Delete this?" onConfirm={doIt} onClose={() => setDialog(null)} />
 *
 * Usage — error:
 *   <Dialog type="error" message="Something went wrong." onClose={() => setDialog(null)} />
 */
export default function Dialog({ type = 'alert', title, message, confirmLabel, onConfirm, onClose }) {
  const okRef = useRef(null)

  useEffect(() => {
    // Auto-focus the primary button for keyboard / accessibility
    setTimeout(() => okRef.current?.focus(), 50)
  }, [])

  const isConfirm = type === 'confirm'
  const isError   = type === 'error'

  const accent = isError ? '#DC2626' : '#951345'
  const iconBg  = isError ? '#FEF2F2' : isConfirm ? '#FFF7ED' : '#F0FDF4'
  const iconBorder = isError ? '#FCA5A5' : isConfirm ? '#FCD34D' : '#6EE7B7'
  const icon = isError ? '⚠️' : isConfirm ? '❓' : '✓'

  const resolvedTitle = title || (isError ? 'Error' : isConfirm ? 'Are you sure?' : 'Done')
  const resolvedConfirmLabel = confirmLabel || (isConfirm ? 'Confirm' : 'OK')

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 env(safe-area-inset-bottom, 0)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '24px 24px 0 0',
          padding: '8px 20px 32px',
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        {/* Handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: '#E5E7EB', margin: '12px auto 24px',
        }} />

        {/* Icon */}
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: iconBg, border: `1.5px solid ${iconBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 16px',
        }}>
          {icon}
        </div>

        {/* Title */}
        <div style={{
          textAlign: 'center', fontSize: 17, fontWeight: 800,
          color: '#0D0C1D', marginBottom: 8, fontFamily: 'Sora, sans-serif',
        }}>
          {resolvedTitle}
        </div>

        {/* Message */}
        {message && (
          <div style={{
            textAlign: 'center', fontSize: 14, color: '#6B7280',
            lineHeight: 1.55, marginBottom: 24, padding: '0 8px',
          }}>
            {message}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          {isConfirm && (
            <button onClick={onClose} style={{
              flex: 1, padding: '14px 0', borderRadius: 14,
              background: '#F5F4FB', border: '1px solid #EDE9FF',
              color: '#6B7280', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            onClick={() => { onConfirm?.(); onClose() }}
            style={{
              flex: 1, padding: '14px 0', borderRadius: 14,
              background: `linear-gradient(135deg, ${accent}, ${isError ? '#B91C1C' : '#720D35'})`,
              border: 'none', color: '#fff', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: `0 4px 14px ${accent}40`,
            }}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
