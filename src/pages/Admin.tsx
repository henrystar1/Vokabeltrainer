import { useState, type ReactNode } from 'react'
import { Flag, Gift, KeyRound, MessageSquarePlus, Radio, ShieldCheck, SlidersHorizontal, Store, Ticket, Users } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useAsync } from '../lib/useAsync'
import { getMyPermissions } from '../services/koins'
import FeedbackTab from './admin/FeedbackTab'
import { CodesSection, GrantSection, ItemsSection } from './admin/KoinsTab'
import ModRightsTab from './admin/ModRightsTab'
import OnlineTab from './admin/OnlineTab'
import ReviewsTab from './admin/ReviewsTab'
import RulesTab from './admin/RulesTab'
import UsersTab from './admin/UsersTab'

type Tab = 'reviews' | 'feedback' | 'online' | 'users' | 'modrights' | 'rules' | 'shop' | 'codes' | 'grant'
interface TabDef { id: Tab; label: string; icon: ReactNode }
interface Group { id: string; label: string; icon: ReactNode; tabs: TabDef[] }

/** Verwaltung: oben die Bereiche, darunter die Seiten des Bereichs. Was jemand sieht, hängt von seinen Rechten ab. */
export default function Admin() {
  const { isAdmin, role } = useAuth()
  const perms = useAsync(getMyPermissions, [])
  const p = perms.data

  const groups: Group[] = [
    {
      id: 'mod',
      label: 'Moderation',
      icon: <ShieldCheck size={16} />,
      tabs: [
        { id: 'reviews', label: 'Prüfanfragen', icon: <Flag size={15} /> },
        { id: 'feedback', label: 'Feedback', icon: <MessageSquarePlus size={15} /> },
        ...(isAdmin ? [{ id: 'online' as const, label: 'Online & Nachrichten', icon: <Radio size={15} /> }] : []),
      ],
    },
    ...(isAdmin
      ? [{
          id: 'people',
          label: 'Nutzer',
          icon: <Users size={16} />,
          tabs: [
            { id: 'users' as const, label: 'Benutzer', icon: <Users size={15} /> },
            { id: 'modrights' as const, label: 'Mod-Rechte', icon: <KeyRound size={15} /> },
          ],
        }]
      : []),
    ...(p && (p.settings || p.shop || isAdmin)
      ? [{
          id: 'economy',
          label: 'Regeln & Wirtschaft',
          icon: <SlidersHorizontal size={16} />,
          tabs: [
            ...(p.settings ? [{ id: 'rules' as const, label: 'Zahlen', icon: <SlidersHorizontal size={15} /> }] : []),
            ...(p.shop ? [{ id: 'shop' as const, label: 'Shop-Preise', icon: <Store size={15} /> }] : []),
            ...(isAdmin ? [{ id: 'codes' as const, label: 'Codes', icon: <Ticket size={15} /> }, { id: 'grant' as const, label: 'Coins schenken', icon: <Gift size={15} /> }] : []),
          ],
        }]
      : []),
  ]

  const [tab, setTab] = useState<Tab>('reviews')
  const group = groups.find((g) => g.tabs.some((t) => t.id === tab)) ?? groups[0]
  const active = group.tabs.some((t) => t.id === tab) ? tab : group.tabs[0].id

  const pill = (on: boolean) =>
    `inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
      on ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`

  return (
    <div>
      <PageHeader eyebrow={role === 'admin' ? 'Admin' : role === 'alphamod' ? 'Alphamod' : 'Mod'} title="Verwaltung" />
      {perms.error && <ErrorBox message={perms.error} onRetry={perms.reload} />}
      {perms.loading && !p && <Spinner />}
      <nav aria-label="Bereiche" className="mb-3 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {groups.map((g) => (
          <button key={g.id} type="button" onClick={() => setTab(g.tabs[0].id)} className={pill(g.id === group.id)}>
            {g.icon} {g.label}
          </button>
        ))}
      </nav>
      {group.tabs.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5" role="tablist">
          {group.tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => setTab(t.id)} className={`${pill(t.id === active)} !min-h-[40px] !px-3`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}
      {group.tabs.length === 1 && <div className="mb-5" />}
      {active === 'reviews' && <ReviewsTab />}
      {active === 'feedback' && <FeedbackTab />}
      {active === 'online' && isAdmin && <OnlineTab />}
      {active === 'users' && isAdmin && <UsersTab />}
      {active === 'modrights' && isAdmin && <ModRightsTab />}
      {active === 'rules' && p?.settings && <RulesTab perms={p} />}
      {active === 'shop' && p?.shop && <ItemsSection />}
      {active === 'codes' && isAdmin && <CodesSection />}
      {active === 'grant' && isAdmin && <GrantSection />}
    </div>
  )
}
