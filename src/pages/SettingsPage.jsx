import { useAuthStore } from '../store/authStore'

export default function SettingsPage() {
  const { user, familyName, inviteCode, signOut } = useAuthStore()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">⚙️ Settings</div>
          <div className="top-bar-sub">Account & preferences</div>
        </div>
      </div>

      <div className="page-content">
        {/* Profile Card */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1f6e 0%, #2d1b69 100%)',
          borderRadius: 20, padding: 20, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 8px 32px rgba(91,110,245,0.25)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 800, color: '#fff',
            border: '2px solid rgba(255,255,255,0.3)',
          }}>
            {user?.email?.[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
              {user?.user_metadata?.display_name || 'You'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 }}>
              {user?.email}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
              {familyName}
            </div>
          </div>
        </div>

        {/* Family Code */}
        <div className="settings-card">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Your Family Invite Code
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 6, color: 'var(--blue)' }}>
              {inviteCode}
            </div>
            <button onClick={() => { navigator.clipboard.writeText(inviteCode); alert('Copied!') }}
              style={{
                background: 'var(--blue-light)', border: 'none', borderRadius: 10,
                padding: '8px 14px', color: 'var(--blue)', fontWeight: 700,
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              📋 Copy
            </button>
          </div>
        </div>

        {/* App Info */}
        <div className="settings-card">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            About
          </div>
          {[
            { label: 'App', value: 'FamilyGuard' },
            { label: 'Version', value: '1.0.0' },
            { label: 'Platform', value: 'Web (PWA Ready)' },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text2)' }}>{item.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{item.value}</span>
            </div>
          ))}
        </div>

        {/* Sign Out */}
        <button onClick={() => { if (window.confirm('Sign out of FamilyGuard?')) signOut() }}
          style={{
            width: '100%', padding: 15, borderRadius: 16,
            background: 'var(--red-light)', border: '1.5px solid rgba(245,59,87,0.2)',
            color: 'var(--red)', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer', marginTop: 8,
          }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}
