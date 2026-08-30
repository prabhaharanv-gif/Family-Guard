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
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 20,
          padding: '22px 20px 18px',
          width: '100%',
          maxWidth: 320,
          boxShadow: '0 18px 50px rgba(0,0,0,0.3)',
          animation: 'dialogIn 0.18s cubic-bezier(0.34,1.4,0.64,1)',
        }}
      >
        {/* A centred card rather than a full-width sheet. As a sheet this ran
            ~280px tall for a single sentence, most of it a drag handle, a 56px
            icon and sheet padding — none of which a one-line confirmation needs.
            Scale-in suits a centred card; the old slide-up belonged to a sheet
            anchored to the bottom edge. */}
        <style>{`@keyframes dialogIn{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}`}</style>

        {/* Icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: iconBg, border: `1.5px solid ${iconBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 19, margin: '0 auto 12px',
        }}>
          {icon}
        </div>

        {/* Title */}
        <div style={{
          textAlign: 'center', fontSize: 15.5, fontWeight: 800,
          color: '#0D0C1D', marginBottom: 6, fontFamily: 'Sora, sans-serif',
        }}>
          {resolvedTitle}
        </div>

        {/* Message */}
        {message && (
          <div style={{
            textAlign: 'center', fontSize: 13, color: '#6B7280',
            lineHeight: 1.5, marginBottom: 16,
          }}>
            {message}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          {isConfirm && (
            <button onClick={onClose} style={{
              flex: 1, padding: '11px 0', borderRadius: 12,
              background: '#F5F4FB', border: '1px solid #EDE9FF',
              color: '#6B7280', fontWeight: 700, fontSize: 13.5,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            onClick={() => { onConfirm?.(); onClose() }}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 12,
              background: `linear-gradient(135deg, ${accent}, ${isError ? '#B91C1C' : '#720D35'})`,
              border: 'none', color: '#fff', fontWeight: 700, fontSize: 13.5,
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
