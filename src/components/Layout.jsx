import { Outlet, NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', end: true, icon: '👨‍👩‍👧‍👦', label: 'Family' },
  { to: '/messages', icon: '💬', label: 'Messages' },
  { to: '/sos', icon: '🆘', label: 'SOS' },
  { to: '/map-all', icon: '🗺️', label: 'Map' },
]

export default function Layout() {
  return (
    <div className="app-shell">
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <div className="nav-icon-wrap">
              <span className="nav-icon">{item.icon}</span>
            </div>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
