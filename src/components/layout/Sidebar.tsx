import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Rocket } from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import KoinBadge from '../profile/KoinBadge'
import PlayerTag from '../profile/PlayerTag'
import { navGroupsFor } from '../../lib/navigation'
import { useLocks } from '../../features/locks/LocksProvider'
import { useChat } from '../../features/chat/ChatProvider'
import { usePrintTodo } from '../../features/print/hooks'
import { usePlus } from '../../features/plus/PlusProvider'
import { Lock } from 'lucide-react'
import LangPicker from './LangPicker'
import { useSettings } from '../../features/settings/SettingsProvider'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { displayName, user, signOut, isStaff, cosmetics } = useAuth()
  const { unread } = useChat()
  const { locked } = useLocks()
  const todo = usePrintTodo()?.todo ?? 0
  const plus = usePlus()
  const { settings } = useSettings()
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

      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-2">
        {navGroupsFor(isStaff, locked, settings.learn_language).map((grp, gi) => (
          <div key={grp.title || 'top'} className={gi > 0 ? 'mt-3' : ''}>
            {grp.title &&
              (collapsed ? (
                <div className="mx-3 mb-1 border-t border-white/10" aria-hidden />
              ) : (
                <p className="label-mono px-3 pb-1 pt-1 text-[10px] uppercase tracking-widest text-slate-500">{grp.title}</p>
              ))}
            {grp.langPicker && <LangPicker collapsed={collapsed} />}
            <div className="space-y-0.5">
              {grp.items.map(({ to, label, icon: Icon, plus: isPlus, brand }) => {
                const teaser = !!isPlus && !plus.active
                return (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `group relative flex min-h-[40px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                      isActive
                        ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]'
                        : brand
                          ? 'text-fuchsia-300 hover:bg-fuchsia-400/10'
                          : teaser
                          ? 'plus-nav text-fuchsia-300 hover:bg-fuchsia-400/10'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    }`
                  }
                >
                  <span className="relative shrink-0">
                    <Icon size={19} />
                    {to === '/chat' && unread > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-space-900" aria-label="Neue Nachrichten" />}
                    {to === '/druckshop' && todo > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-space-900" aria-label="Offene Druckaufträge" />}
                  </span>
                  {!collapsed && <span className="truncate">{label}</span>}
                  {teaser && !collapsed && <Lock size={13} className="ml-auto shrink-0 opacity-80" aria-label="Mit Plus" />}
                  {!collapsed && to === '/druckshop' && todo > 0 && (
                    <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-space-950">{todo > 99 ? '99+' : todo}</span>
                  )}
                  {!collapsed && to === '/chat' && unread > 0 && (
                    <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
                  )}
                </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-slate-300">
          {collapsed ? (
            <PlayerTag name={displayName ?? 'Benutzer'} cosmetics={{ ...cosmetics, role: undefined, tag_id: null }} className="[&>span:not(:first-child)]:hidden" />
          ) : (
            <div className="min-w-0">
              <PlayerTag name={displayName ?? 'Benutzer'} cosmetics={cosmetics} />
              <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
            </div>
          )}
        </div>
        <div className={`flex ${collapsed ? 'justify-center' : 'px-3'}`}>
          <KoinBadge compact={collapsed} />
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
