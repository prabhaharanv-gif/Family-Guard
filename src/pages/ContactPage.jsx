import { Link } from 'react-router-dom'
import PublicPage, { PublicCard } from '../components/PublicPage'
import Icon from '../components/Icon'
import { SITE_URL, CONTACT_EMAIL, CONTACT_PHONE, SUPPORT_NAME } from '../lib/siteConfig'

/**
 * Contact / support page.
 *
 * Every detail comes from lib/siteConfig.js. A row whose value is not set is left
 * out in production rather than shown with filler text; in development the phone
 * row shows a loud placeholder so the layout can still be checked.
 */
export default function ContactPage() {
  const phone = CONTACT_PHONE || (import.meta.env.DEV ? '+91 XXXXXXXXXX (placeholder: set CONTACT_PHONE)' : '')

  const rows = [
    { icon: 'message', label: 'Email', value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
    phone && { icon: 'phone', label: 'Phone', value: phone, href: CONTACT_PHONE ? `tel:${CONTACT_PHONE.replace(/\s+/g, '')}` : undefined },
    { icon: 'globe', label: 'Website', value: SITE_URL.replace(/^https?:\/\//, ''), href: SITE_URL },
  ].filter(Boolean)

  return (
    <PublicPage title="Contact" subtitle={SUPPORT_NAME}>
      <PublicCard title={SUPPORT_NAME}>
        Questions about Kinest, a problem with the app, or a privacy request? Get in touch
        and include the mobile number you signed up with, so we can find your account.
      </PublicCard>

      <section style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 16, padding: '6px 18px', marginBottom: 12 }}>
        {rows.map((r, i) => {
          const inner = (
            <>
              <span style={{
                width: 38, height: 38, borderRadius: 11, background: 'var(--maroon-tint)', color: 'var(--maroon)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><Icon name={r.icon} size={19} /></span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text3, #7A5565)' }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--maroon)', overflowWrap: 'anywhere' }}>{r.value}</span>
              </span>
            </>
          )
          const style = {
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', textDecoration: 'none',
            borderTop: i === 0 ? 'none' : '1px solid #F3E9ED',
          }
          return r.href
            ? <a key={r.label} href={r.href} style={style}>{inner}</a>
            : <div key={r.label} style={style}>{inner}</div>
        })}
      </section>

      <PublicCard title="Other help">
        <div style={{ display: 'grid', gap: 8 }}>
          <Link to="/manual" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Help &amp; user guide</Link>
          <Link to="/delete-account" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Delete your account and data</Link>
          <Link to="/privacy" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Terms of Use</Link>
        </div>
      </PublicCard>
    </PublicPage>
  )
}
