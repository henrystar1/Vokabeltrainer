import { useState, type ReactNode } from 'react'
import { Flag, Users } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../features/auth/AuthProvider'
import ReviewsTab from './admin/ReviewsTab'
import UsersTab from './admin/UsersTab'

type Tab = 'reviews' | 'users'

/** Verwaltung für Mods (Prüfanfragen) und Admins (zusätzlich Benutzer). */
export default function Admin() {
  const { isAdmin, role } = useAuth()
  const [tab, setTab] = useState<Tab>('reviews')

  const button = (t: Tab, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
        tab === t ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
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
        {isAdmin && button('users', 'Benutzer', <Users size={16} />)}
      </div>
      {tab === 'reviews' && <ReviewsTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
    </div>
  )
}
