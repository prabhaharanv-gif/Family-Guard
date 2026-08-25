import { Outlet, NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  {
    to: '/', end: true, label: 'Family',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M9 11C11.2091 11 13 9.20914 13 7C13 4.79086 11.2091 3 9 3C6.79086 3 5 4.79086 5 7C5 9.20914 6.79086 11 9 11Z" fill={active ? '#951345' : '#9CA3AF'}/>
        <path d="M17 9C18.6569 9 20 7.65685 20 6C20 4.34315 18.6569 3 17 3C15.3431 3 14 4.34315 14 6C14 7.65685 15.3431 9 17 9Z" fill={active ? '#951345' : '#9CA3AF'}/>
        <path d="M9 13C5.68629 13 3 15.6863 3 19V21H15V19C15 15.6863 12.3137 13 9 13Z" fill={active ? '#951345' : '#9CA3AF'}/>
        <path d="M17 11C14.7 11 13 12.5 13 14.5V21H21V14.5C21 12.5 19.3 11 17 11Z" fill={active ? '#951345' : '#C4C4C4'}/>
      </svg>
    ),
  },
  {
    to: '/messages', label: 'Messages',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill={active ? '#951345' : '#9CA3AF'}/>
        <circle cx="8" cy="10" r="1.5" fill="white"/>
        <circle cx="12" cy="10" r="1.5" fill="white"/>
        <circle cx="16" cy="10" r="1.5" fill="white"/>
      </svg>
    ),
  },
  {
    to: '/sos', label: 'SOS',
    icon: (active) => (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#E11D48"/>
        <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="900" fill="white" fontFamily="Arial">SOS</text>
      </svg>
    ),
  },
  {
    to: '/map-all', label: 'Map',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M9 4L3 7V20L9 17L15 20L21 17V4L15 7L9 4Z" fill={active ? '#951345' : '#9CA3AF'}/>
        <line x1="9" y1="4" x2="9" y2="17" stroke="white" strokeWidth="1.5"/>
        <line x1="15" y1="7" x2="15" y2="20" stroke="white" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    to: '/profile', label: 'Profile',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" fill={active ? '#951345' : '#9CA3AF'}/>
        <path d="M4 20C4 16.6863 7.58172 14 12 14C16.4183 14 20 16.6863 20 20" stroke={active ? '#951345' : '#9CA3AF'} strokeWidth="2.5" strokeLinecap="round"/>
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
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
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
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
