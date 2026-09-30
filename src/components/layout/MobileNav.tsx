import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../../lib/navigation'

/** Untere Tab-Leiste für Smartphone (Hochformat). Auf dem iPad übernimmt die Sidebar. */
export default function MobileNav() {
  const primary = NAV_ITEMS.filter((i) => ['/', '/buecher', '/lernen', '/test', '/statistik'].includes(i.to))
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-30 flex border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
      {primary.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
              isActive ? 'text-accent-cyan' : 'text-slate-500'
            }`
          }
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
