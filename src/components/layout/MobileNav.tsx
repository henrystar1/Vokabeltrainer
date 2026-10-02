import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, MoreHorizontal, X } from 'lucide-react'
import { navItemsFor } from '../../lib/navigation'
import { useAuth } from '../../features/auth/AuthProvider'

const PRIMARY = ['/', '/buecher', '/lernen', '/test']

/** Untere Tab-Leiste für Smartphone. Weitere Bereiche liegen unter „Mehr“. Auf dem iPad übernimmt die Sidebar. */
export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const { displayName, signOut, isStaff } = useAuth()
  const NAV_ITEMS = navItemsFor(isStaff)
  const { pathname } = useLocation()
  const primary = NAV_ITEMS.filter((i) => PRIMARY.includes(i.to))
  const more = NAV_ITEMS.filter((i) => !PRIMARY.includes(i.to))
  const moreActive = more.some((i) => pathname.startsWith(i.to))

  const tab = (active: boolean) =>
    `flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
      active ? 'text-accent-cyan' : 'text-slate-500'
    }`

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)}>
          <div
            className="glass absolute inset-x-3 bottom-[76px] space-y-1 rounded-2xl p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <span className="text-sm text-slate-400">{displayName ?? 'Benutzer'}</span>
              <button aria-label="Schließen" onClick={() => setOpen(false)} className="p-1 text-slate-400">
                <X size={18} />
              </button>
            </div>
            {more.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm ${isActive ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-slate-200'}`
                }
              >
                <Icon size={19} />
                {label}
              </NavLink>
            ))}
            <button
              onClick={() => void signOut()}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-sm text-slate-300"
            >
              <LogOut size={19} />
              Abmelden
            </button>
          </div>
        </div>
      )}
      <nav className="glass fixed inset-x-0 bottom-0 z-50 flex border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => tab(isActive)}>
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
        <button onClick={() => setOpen((o) => !o)} className={tab(open || moreActive)} aria-expanded={open}>
          <MoreHorizontal size={20} />
          Mehr
        </button>
      </nav>
    </>
  )
}
