import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Button } from '../ui/kit'
import { usePlatformAuth } from './PlatformAuth'
import '../ui/pages/platform.css'

// Operator navigation, filtered by the operator's own permissions (server
// checks every call as well).
export const PLATFORM_NAV = [
  { to: '/platform/dashboard', label: 'Dashboard', permission: 'firm.read' },
  { to: '/platform/firms', label: 'Firms', permission: 'firm.read' },
  { to: '/platform/audit', label: 'Audit', permission: 'audit.read' },
]

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const { operator, can, logout } = usePlatformAuth()
  const navigate = useNavigate()
  const signOut = async () => { await logout(); navigate('/platform/login', { replace: true }) }
  return (
    <div className="pf-shell">
      <header className="pf-top">
        <span className="pf-brand">AMS</span>
        <span className="pf-badge">Platform admin</span>
        <nav aria-label="Platform">
          {PLATFORM_NAV.filter((n) => can(n.permission)).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
          ))}
        </nav>
        <span className="pf-who">{operator?.email} · {operator?.role}</span>
        <Button size="sm" variant="ghost" onClick={signOut} style={{ color: 'inherit' }}>Sign out</Button>
      </header>
      <main className="pf-main">{children}</main>
    </div>
  )
}
