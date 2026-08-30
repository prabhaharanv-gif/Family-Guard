/**
 * AnchoredMenu
 *
 * A compact dropdown positioned next to the element that opened it, used for
 * the message long-press menu and both member-card menus.
 *
 * Anchoring rather than sliding a sheet up from the bottom: the actions appear
 * beside the thing they act on, so the menu needs no header repeating which
 * item was tapped and no Cancel button — tapping outside closes it. That makes
 * it roughly a third the height of the sheets it replaces.
 *
 * `anchor` is the opening element's bounding rect in viewport coordinates, read
 * in the pointer handler. It has to be captured there rather than later: React
 * nulls currentTarget once the handler returns, so a rect read inside a
 * long-press timeout is always null.
 *
 * Items: { label, sub?, icon?, color?, danger?, disabled?, onClick }
 */
export default function AnchoredMenu({ anchor, items = [], onClose, width = 210, align = 'auto' }) {
  const rows = items.filter(Boolean)
  if (rows.length === 0) return null

  const ROW_H = rows.some(r => r.sub) ? 52 : 40
  const PAD    = 12
  const height = rows.length * ROW_H + PAD

  const vw = typeof window === 'undefined' ? 360 : window.innerWidth
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight
  const M  = 10   // keep clear of the screen edges

  let left
  if (!anchor)                left = (vw - width) / 2
  else if (align === 'right') left = anchor.right - width
  else if (align === 'left')  left = anchor.left
  else                        left = anchor.left + (anchor.width - width) / 2
  left = Math.max(M, Math.min(left, vw - width - M))

  // Below the anchor by default, flipped above when there is no room. Both
  // clamped, so an element near an edge still yields a fully visible menu.
  let top = anchor ? anchor.bottom + 6 : (vh - height) / 2
  if (top + height > vh - M) {
    top = anchor ? anchor.top - height - 6 : top
    if (top < M) top = Math.max(M, vh - height - M)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(13,12,29,0.16)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top, left, width,
          background: '#fff', borderRadius: 14,
          border: '1px solid #F0E4EA',
          boxShadow: '0 14px 36px rgba(20,8,24,0.24)',
          padding: 6, overflow: 'hidden',
        }}
      >
        {rows.map((a, i) => (
          <div key={a.label}>
            {i > 0 && <div style={{ height: 1, background: '#F7EFF3', margin: '0 6px' }} />}
            <button
              onClick={() => { if (a.disabled) return; a.onClick?.(); onClose?.() }}
              disabled={a.disabled}
              style={{
                width: '100%', minHeight: ROW_H, padding: '0 8px',
                background: 'none', border: 'none',
                cursor: a.disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
                opacity: a.disabled ? 0.45 : 1,
              }}
            >
              {a.icon && (
                <span style={{ color: a.color || '#951345', display: 'flex', flexShrink: 0 }}>
                  {a.icon}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 13.5, fontWeight: 700,
                  color: a.danger ? (a.color || '#E11D48') : '#0D0C1D',
                }}>
                  {a.label}
                </span>
                {a.sub && (
                  <span style={{
                    display: 'block', fontSize: 11, color: '#9C6B7A', marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.sub}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
