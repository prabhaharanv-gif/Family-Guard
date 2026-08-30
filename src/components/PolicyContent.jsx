/**
 * PolicyContent
 *
 * Privacy policy rendered as a compact stack of cards, for ConsentGate's
 * "Read Full Policy" view. The text itself lives in src/lib/policy.js, which
 * PrivacyPolicyPage renders too — this file owns only the presentation.
 */

import { getPolicy } from '../lib/policy'
import { useT } from '../i18n'

export default function PolicyContent() {
  const t = useT()
  const p = getPolicy(t.lang)
  return (
    <div>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '14px 16px',
        marginBottom: 10, border: '1px solid #F0EAF5',
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D', marginBottom: 6 }}>
          {p.consentTitle}
        </div>
        <div style={{ fontSize: 12, color: '#9C6B7A', marginBottom: 10 }}>
          {p.lastUpdatedLabel} {p.lastUpdated}
        </div>
        <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.55 }}>
          {p.intro}
        </div>
      </div>

      {p.sections.map(s => (
        <div key={s.key} style={{
          background: '#fff', borderRadius: 16, padding: '14px 16px',
          marginBottom: 10, border: '1px solid #F0EAF5',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D' }}>{s.title}</span>
          </div>
          {s.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: s.color, marginTop: 6, flexShrink: 0,
              }} />
              <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5 }}>{item}</div>
            </div>
          ))}
        </div>
      ))}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '14px 16px',
        textAlign: 'center', border: '1px solid #F0EAF5',
      }}>
        <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.55 }}>
          {p.consentNote}
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 10 }}>
          {p.contactPromptConsent}{' '}
          <a href={`mailto:${p.contactEmail}`} style={{ color: '#951345', fontWeight: 700 }}>
            {p.contactEmail}
          </a>
        </div>
      </div>
    </div>
  )
}
