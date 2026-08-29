import { Outlet, NavLink } from 'react-router-dom'

// Premium custom SVG nav icons — pixel-perfect, brand-aligned
const NAV_ITEMS = [
  {
    to: '/', end: true, label: 'Family',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="7" r="3" fill={active ? '#951345' : '#A0A0B0'}/>
        <path d="M3 20C3 16.134 5.686 13 9 13C12.314 13 15 16.134 15 20H3Z" fill={active ? '#951345' : '#A0A0B0'}/>
        <circle cx="17.5" cy="8.5" r="2.2" fill={active ? '#C0185A' : '#C4C4D0'}/>
        <path d="M13.5 20C13.5 17.239 15.239 15 17.5 15C19.761 15 21.5 17.239 21.5 20H13.5Z" fill={active ? '#C0185A' : '#C4C4D0'}/>
      </svg>
    ),
  },
  {
    to: '/messages', label: 'Messages',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z"
          fill={active ? '#951345' : '#A0A0B0'} stroke="none"/>
        <circle cx="8" cy="10" r="1.4" fill="#fff"/>
        <circle cx="12" cy="10" r="1.4" fill="#fff"/>
        <circle cx="16" cy="10" r="1.4" fill="#fff"/>
      </svg>
    ),
  },
  {
    to: '/sos', label: 'SOS',
    icon: () => (
      <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          position: 'absolute', inset: -3, borderRadius: '50%',
          border: '2px solid #951345', opacity: 0.3,
        }} />
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(145deg, #F43F5E 0%, #BE123C 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 3px 10px rgba(244,63,94,0.45)',
        }}>
          <span style={{
            fontFamily: 'Sora, sans-serif',
            fontSize: 9, fontWeight: 900,
            color: '#fff', letterSpacing: 0.4,
            lineHeight: 1, userSelect: 'none',
            position: 'relative', top: 1,
          }}>SOS</span>
        </div>
      </div>
    ),
  },
  {
    to: '/map-all', label: 'Map',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M9 4L3 7.5V20L9 16.5L15 20L21 16.5V4L15 7.5L9 4Z"
          fill={active ? '#951345' : '#A0A0B0'}/>
        <line x1="9" y1="4" x2="9" y2="16.5" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="15" y1="7.5" x2="15" y2="20" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="12" cy="11" r="2" fill="#fff" opacity="0.9"/>
        <circle cx="12" cy="11" r="1" fill={active ? '#951345' : '#A0A0B0'}/>
      </svg>
    ),
  },
  {
    to: '/profile', label: 'Profile',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="3.8" fill={active ? '#951345' : '#A0A0B0'}/>
        <path d="M4 20C4 16.134 7.582 13 12 13C16.418 13 20 16.134 20 20"
          stroke={active ? '#951345' : '#A0A0B0'} strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
]

export default function Layout({ unreadMessages = 0 }) {
  return (
    <div className="app-shell">
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onContextMenu={e => e.preventDefault()}
            draggable={false}
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
          >
            {({ isActive }) => (
              <>
                <div className="nav-icon-wrap" style={{ position: 'relative' }}>
                  {item.icon(isActive)}
                  {item.to === '/messages' && unreadMessages > 0 && (
                    <span className="nav-badge">
                      {unreadMessages > 99 ? '99+' : unreadMessages}
                    </span>
                  )}
                </div>
                <span style={{ position: 'relative', zIndex: 1 }}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
