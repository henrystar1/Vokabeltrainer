import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, MoreHorizontal, X } from 'lucide-react'
import { navGroupsFor, navItemsFor } from '../../lib/navigation'
import { useChat } from '../../features/chat/ChatProvider'
import KoinBadge from '../profile/KoinBadge'
import { useAuth } from '../../features/auth/AuthProvider'
import { useLocks } from '../../features/locks/LocksProvider'

const PRIMARY = ['/', '/buecher', '/lernen', '/test']

/** Untere Tab-Leiste für Smartphone. Weitere Bereiche liegen unter „Mehr“. Auf dem iPad übernimmt die Sidebar. */
export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const { displayName, signOut, isStaff } = useAuth()
  const { unread } = useChat()
  const { locked } = useLocks()
  const NAV_ITEMS = navItemsFor(isStaff, locked)
  const groups = navGroupsFor(isStaff, locked)
    .map((grp) => ({ ...grp, items: grp.items.filter((i) => !PRIMARY.includes(i.to)) }))
    .filter((grp) => grp.items.length > 0)
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
            className="glass absolute inset-x-3 bottom-[76px] max-h-[70vh] space-y-1 overflow-y-auto rounded-2xl p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <span className="flex items-center gap-3 text-sm text-slate-400">
                {displayName ?? 'Benutzer'}
                <KoinBadge compact />
              </span>
              <button aria-label="Schließen" onClick={() => setOpen(false)} className="p-1 text-slate-400">
                <X size={18} />
              </button>
            </div>
            {groups.map((grp) => (
              <div key={grp.title || 'top'} className="pb-1">
                {grp.title && <p className="label-mono px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-slate-500">{grp.title}</p>}
                <div className="grid grid-cols-2 gap-1">
                  {grp.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `relative flex min-h-[48px] items-center gap-2.5 rounded-xl px-3 text-sm ${isActive ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-white/[0.03] text-slate-200'}`
                      }
                    >
                      <Icon size={18} className="shrink-0" />
                      <span className="truncate">{label}</span>
                      {to === '/chat' && unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500" aria-label="Neue Nachrichten" />}
                    </NavLink>
                  ))}
                </div>
              </div>
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
          <span className="relative">
            <MoreHorizontal size={20} />
            {unread > 0 && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-space-900" aria-label="Neue Nachrichten" />}
          </span>
          Mehr
        </button>
      </nav>
    </>
  )
}
