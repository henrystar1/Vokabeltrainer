import { useState, type ReactNode } from 'react'
import CoinIcon from '../components/ui/CoinIcon'
import { Flag, MessageSquarePlus, Radio, SlidersHorizontal, Users } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../features/auth/AuthProvider'
import FeedbackTab from './admin/FeedbackTab'
import KoinsTab from './admin/KoinsTab'
import OnlineTab from './admin/OnlineTab'
import ReviewsTab from './admin/ReviewsTab'
import RulesTab from './admin/RulesTab'
import UsersTab from './admin/UsersTab'

type Tab = 'reviews' | 'feedback' | 'users' | 'koins' | 'online' | 'rules'

/** Verwaltung für Mods (Prüfanfragen) und Admins (zusätzlich Benutzer). */
export default function Admin() {
  const { isAdmin, role } = useAuth()
  const [tab, setTab] = useState<Tab>('reviews')

  const button = (t: Tab, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
        tab === t ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
      }`}
    >
      {icon} {label}
    </button>
  )

  return (
    <div>
      <PageHeader eyebrow={role === 'admin' ? 'Admin' : 'Mod'} title="Verwaltung" />
      <div className="mb-5 flex flex-wrap gap-2">
        {button('reviews', 'Prüfanfragen', <Flag size={16} />)}
        {button('feedback', 'Feedback', <MessageSquarePlus size={16} />)}
        {button('rules', 'Regeln', <SlidersHorizontal size={16} />)}
        {isAdmin && button('online', 'Online & Nachrichten', <Radio size={16} />)}
        {isAdmin && button('users', 'Benutzer', <Users size={16} />)}
        {isAdmin && button('koins', 'Coins & Shop', <CoinIcon size={16} />)}
      </div>
      {tab === 'reviews' && <ReviewsTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'koins' && isAdmin && <KoinsTab />}
      {tab === 'online' && isAdmin && <OnlineTab />}
    </div>
  )
}
