import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import { useLocks } from '../features/locks/LocksProvider'
import { hubPageFor } from '../lib/navigation'

const TEXT = {
  games: { eyebrow: 'Spiele', title: 'Alle Spiele', sub: 'Allein, mit anderen oder um Chips – alles an einem Ort.' },
  shop: { eyebrow: 'Shop', title: 'Shop, Plus & Pro', sub: 'Einkaufen, drucken lassen und Funktionen freischalten.' },
} as const

/** Sammelseite: Kacheln für alle Spiele bzw. alles rund um Shop, Plus und Pro. */
export default function HubPage({ of }: { of: 'games' | 'shop' }) {
  const { locked } = useLocks()
  const groups = hubPageFor(of, locked)
  const t = TEXT[of]
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.eyebrow} title={t.title} />
      <p className="-mt-3 text-sm text-slate-400">{t.sub}</p>
      {groups.length === 0 && <p className="text-sm text-slate-400">Hier ist gerade nichts freigeschaltet.</p>}
      {groups.map((grp) => (
        <section key={grp.title} aria-label={grp.title || t.title}>
          {grp.title && <h2 className="mb-3 text-base font-semibold text-white">{grp.title}</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grp.items.map(({ to, label, icon: Icon, hub, brand }) => (
              <Link key={to} to={to} className="glass flex min-h-[64px] items-center gap-3 rounded-2xl p-4 transition hover:bg-white/10">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${brand ? 'bg-amber-400/15 text-amber-300' : 'bg-accent-cyan/10 text-accent-cyan'}`}><Icon size={20} /></span>
                <span className="min-w-0"><span className="block font-medium text-white">{label}</span>{hub && <span className="block text-xs text-slate-400">{hub}</span>}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
