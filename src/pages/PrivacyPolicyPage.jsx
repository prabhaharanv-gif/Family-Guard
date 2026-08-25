import { useNavigate } from 'react-router-dom'

const SECTIONS = [
  {
    icon: '📋',
    title: 'What We Collect',
    color: '#4F46E5',
    items: [
      'Mobile number (used to create your account)',
      'Display name and optional profile photo',
      'Real-time location (only when sharing is ON)',
      'Messages sent within your family group',
      'SOS alerts you send or receive',
      'Device push notification token (for alerts)',
    ],
  },
  {
    icon: '🔒',
    title: 'How We Use It',
    color: '#059669',
    items: [
      'Location is shared only with your own family group — nobody else',
      'Messages are visible only to your family group members',
      'Push tokens are used only to deliver SOS and message alerts',
      'We never sell, share, or use your data for advertising',
      'We never read your messages for any purpose',
    ],
  },
  {
    icon: '🛡️',
    title: 'How We Protect It',
    color: '#7C3AED',
    items: [
      'All data stored on Supabase (SOC 2 compliant servers)',
      'Row Level Security ensures you only access your family\'s data',
      'Passwords are bcrypt hashed — we cannot see them',
      'All API calls require authentication',
      'Edge Functions verify caller identity before processing any data',
    ],
  },
  {
    icon: '🗑️',
    title: 'Data Retention',
    color: '#D97706',
    items: [
      'Messages are automatically deleted after 90 days',
      'Resolved SOS alerts are deleted after 30 days',
      'Your location is only stored as current position — no history kept',
      'You can delete your account and all data anytime from Profile',
    ],
  },
  {
    icon: '👥',
    title: 'Data Sharing',
    color: '#0891B2',
    items: [
      'We do not share your data with any third parties',
      'Firebase (Google) is used only to deliver push notifications',
      'Supabase is used for database and authentication hosting',
      'No analytics, no tracking, no ads',
    ],
  },
  {
    icon: '✅',
    title: 'Your Rights',
    color: '#16A34A',
    items: [
      'View all your data — it\'s in your own family group',
      'Turn off location sharing anytime from Profile → Privacy',
      'Delete your account and all data from Profile → Delete My Account',
      'Leave any family group at any time',
    ],
  },
]

export default function PrivacyPolicyPage() {
  const navigate = useNavigate()

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
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'Sora, sans-serif' }}>
              Privacy Policy
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              Last updated: August 2026
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
            FamilyGuard is built on a simple promise:{' '}
            <strong style={{ color: '#951345' }}>your data belongs to you and your family — nobody else.</strong>
            {' '}We collect only what is necessary to keep your family safe and connected.
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title} style={{
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
            Questions about your privacy?<br />
            <a href="mailto:info@scoopinnovations.in" style={{ color: '#951345', fontWeight: 700, textDecoration: 'none' }}>
              info@scoopinnovations.in
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
