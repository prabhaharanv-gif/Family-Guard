import { Link } from 'react-router-dom'
import Icon from './Icon'

/**
 * PublicPage — the shell for the plain public pages (Terms, Contact).
 *
 * Same look as the Privacy Policy and Delete Account pages: a fixed layer, a
 * maroon header, and content in a column that stays readable on a desktop
 * instead of stretching across it. The back arrow goes to the website home,
 * since these pages are usually opened straight from the footer or a store
 * listing, where there is no history to go back to.
 */
export default function PublicPage({ title, subtitle, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', zIndex: 100,
    }}>
      <div style={{
        background: 'linear-gradient(135deg, var(--maroon) 0%, var(--maroon-deep) 100%)',
        padding: '16px 16px 20px', flexShrink: 0, boxShadow: '0 2px 12px rgba(139,13,61,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 760, margin: '0 auto' }}>
          <Link to="/" aria-label="Kinest home" style={{
            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, width: 36, height: 36, color: '#fff', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="arrowLeft" size={18} /></Link>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'Sora, sans-serif', lineHeight: 1.35 }}>{title}</h1>
            {subtitle && (
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.82)', marginTop: 2, lineHeight: 1.5 }}>{subtitle}</div>
            )}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px max(16px, calc((100% - 760px) / 2)) 40px' }}>
        {children}
      </div>
    </div>
  )
}

/** A white card with a maroon heading, matching the cards on the other public pages. */
export function PublicCard({ title, children }) {
  return (
    <section style={{
      background: '#fff', border: '1.5px solid var(--border)', borderRadius: 16,
      padding: '16px 18px', marginBottom: 12,
    }}>
      {title && <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: 'var(--maroon)', fontFamily: 'Sora, sans-serif' }}>{title}</h2>}
      <div style={{ fontSize: 14, lineHeight: 1.65, color: '#3A1020' }}>{children}</div>
    </section>
  )
}
