import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Rocket, User } from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import { navItemsFor } from '../../lib/navigation'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { displayName, user, signOut, isStaff } = useAuth()
  return (
    <aside
      className={`glass fixed inset-y-0 left-0 z-30 hidden flex-col border-y-0 border-l-0 transition-[width] duration-300 ease-out md:flex ${
        collapsed ? 'w-[76px]' : 'w-64'
      }`}
    >
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-violet to-accent-cyan text-space-950 shadow-glow">
          <Rocket size={18} />
        </div>
        {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">Vokabeltrainer</span>}
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {navItemsFor(isStaff).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                isActive
                  ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`
            }
          >
            <Icon size={19} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-slate-300">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-space-600">
            <User size={16} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayName ?? 'Benutzer'}</p>
              <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
            </div>
          )}
        </div>
        <button
          onClick={() => void signOut()}
          title="Abmelden"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
        >
          <LogOut size={16} />
          {!collapsed && 'Abmelden'}
        </button>
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
          className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
        >
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Einklappen</>}
        </button>
      </div>
    </aside>
  )
}
