import { useNavigate } from 'react-router-dom'
import { getPolicy } from '../lib/policy'
import { useT } from '../i18n'

export default function PrivacyPolicyPage() {
  const navigate = useNavigate()
  const t = useT()
  const p = getPolicy(t.lang)

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: '#F8F7FF',
      zIndex: 100,
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #951345 0%, #720D35 100%)',
        padding: '16px 16px 20px',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(149,19,69,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, width: 36, height: 36,
            cursor: 'pointer', fontSize: 18, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>←</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'Sora, sans-serif', lineHeight: 1.35 }}>
              {p.pageTitle}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {p.lastUpdatedLabel}: {p.lastUpdated}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 40px' }}>

        {/* Intro card */}
        <div style={{
          background: 'linear-gradient(135deg, #FDF0F5, #F0EEFF)',
          borderRadius: 18, padding: '18px 20px', marginBottom: 14,
          border: '1.5px solid #E8DFFF',
          boxShadow: '0 2px 12px rgba(149,19,69,0.08)',
        }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>🛡️</div>
          <div style={{ fontSize: 14, color: '#3A1020', lineHeight: 1.6, fontWeight: 500 }}>
            {p.promiseLead}{' '}
            <strong style={{ color: '#951345' }}>{p.promiseStrong}</strong>
            {' '}{p.promiseTail}
          </div>
        </div>

        {p.sections.map((section) => (
          <div key={section.key} style={{
            background: '#fff',
            borderRadius: 18, padding: '16px 18px',
            marginBottom: 12,
            border: '1px solid #F0EAF5',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: section.color + '15',
                border: `1.5px solid ${section.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
              }}>
                {section.icon}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D' }}>
                {section.title}
              </div>
            </div>

            {/* Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                    background: section.color + '15',
                    border: `1px solid ${section.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginTop: 1,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: section.color }} />
                  </div>
                  <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.55 }}>
                    {item}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Contact */}
        <div style={{
          background: '#fff', borderRadius: 18,
          padding: '18px 20px', textAlign: 'center',
          border: '1px solid #F0EAF5',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>📩</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            {p.contactPrompt}<br />
            <a href={`mailto:${p.contactEmail}`} style={{ color: '#951345', fontWeight: 700, textDecoration: 'none' }}>
              {p.contactEmail}
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
