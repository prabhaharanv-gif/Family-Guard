import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import Icon from './Icon'

/**
 * In-app replacement for alert() and window.confirm().
 *
 * Usage — alert:
 *   <Dialog type="alert" message="Copied!" onClose={() => setDialog(null)} />
 *
 * Usage — confirm:
 *   <Dialog type="confirm" message="Delete this?" onConfirm={doIt} onClose={() => setDialog(null)} />
 *
 * Usage — info (a soft nudge, not a failure; pass a title):
 *   <Dialog type="info" title="Almost there" message="..." onClose={() => setDialog(null)} />
 *
 * Usage — error:
 *   <Dialog type="error" message="Something went wrong." onClose={() => setDialog(null)} />
 */
export default function Dialog({ type = 'alert', title, message, confirmLabel, onConfirm, onClose }) {
  const t = useT()
  const okRef = useRef(null)

  useEffect(() => {
    // Auto-focus the primary button for keyboard / accessibility
    setTimeout(() => okRef.current?.focus(), 50)
  }, [])

  const isConfirm = type === 'confirm'
  const isError   = type === 'error'
  // A gentle nudge — the user just needs to adjust something, nothing failed.
  // No warning sign and no red, which read as "you did something wrong".
  const isInfo    = type === 'info'

  const accent = isError ? '#DC2626' : 'var(--maroon)'
  const iconBg  = isError ? '#FEF2F2' : isConfirm ? '#FFF7ED' : isInfo ? 'var(--maroon-wash)' : '#F0FDF4'
  const iconBorder = isError ? '#FCA5A5' : isConfirm ? '#FCD34D' : isInfo ? '#F0D8E2' : '#6EE7B7'
  const icon = isError ? <Icon name="alert" size={20} color="#DC2626" /> : isConfirm ? <Icon name="help" size={20} color="#D97706" /> : isInfo ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="11" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ) : <Icon name="checkCircle" size={20} color="#059669" />

  const resolvedTitle = title || (isError ? t('dialog.error') : isConfirm ? t('dialog.areYouSure') : isInfo ? t('dialog.pleaseCheck') : t('dialog.done'))
  const resolvedConfirmLabel = confirmLabel || (isConfirm ? t('dialog.confirm') : t('common.ok'))

  // Portalled to <body>: a parent with a transform or backdrop-filter (the
  // auth cards have one) turns position:fixed into "fixed to that parent",
  // which trapped the dialog inside the card.
  return createPortal(
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
          color: 'var(--text)', marginBottom: 6, fontFamily: 'Sora, sans-serif',
        }}>
          {resolvedTitle}
        </div>

        {/* Message */}
        {message && (
          <div style={{
            textAlign: 'center', fontSize: 13, color: 'var(--muted)',
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
              background: 'var(--bg2)', border: '1px solid var(--border)',
              color: 'var(--muted)', fontWeight: 700, fontSize: 13.5,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              {t('common.cancel')}
            </button>
          )}
          <button
            ref={okRef}
            onClick={() => { onConfirm?.(); onClose() }}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 12,
              background: `linear-gradient(135deg, ${accent}, ${isError ? '#B91C1C' : 'var(--maroon-deep)'})`,
              border: 'none', color: '#fff', fontWeight: 700, fontSize: 13.5,
              fontFamily: 'inherit', cursor: 'pointer',
              // No coloured glow under the button, matching .btn-primary.
            }}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  , document.body)
}
