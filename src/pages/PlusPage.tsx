import { Crown, Sparkles } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { Spinner } from '../components/ui/States'
import { usePlus } from '../features/plus/PlusProvider'
import BuyTicker from '../features/plus/BuyTicker'
import PlusTiers from '../features/plus/PlusTiers'
import { plusPerks, proPerks } from '../features/plus/perks'
import { formatDate } from '../lib/format'

/** Eigene Seite für Vokabeltrainer +: Vorteile und Kauf (nur mit Coins). */
export default function PlusPage() {
  const { status } = usePlus()
  if (!status) return <Spinner />
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mehr Möglichkeiten" title="Plus & Pro" />
      <div className="plus-banner flex items-center gap-4 rounded-2xl p-5">
        <Sparkles size={34} className="shrink-0" />
        <div>
          <p className="text-lg font-semibold">{status.active ? 'Du hast Plus' : 'Hol dir Plus mit deinen Coins'}</p>
          <p className="text-sm opacity-80">
            {status.active ? (status.is_admin ? 'Als Admin immer aktiv.' : status.lifetime ? 'Für immer, danke!' : `Läuft bis ${formatDate(status.until)}.`) : 'Ab 100 Coins für einen Tag. Du bezahlst nur mit Coins aus dem Vokabeltrainer.'}
          </p>
        </div>
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Stufen</h2>
        <PlusTiers status={status} />
      </section>
      <div className="pro-banner flex items-center gap-4 rounded-2xl p-5">
        <Crown size={34} className="shrink-0" />
        <div>
          <p className="text-lg font-semibold">{status.pro ? 'Du hast Pro' : 'Vokabeltrainer Pro'}</p>
          <p className="text-sm opacity-80">
            {status.pro ? (status.is_admin ? 'Als Admin immer aktiv.' : status.pro_lifetime ? 'Für immer, danke!' : `Läuft bis ${formatDate(status.pro_until ?? null)}.`) : 'Alles von Plus und noch mehr: Foto-Scan, mehr Coins, Parkour-Vorteile, Skins und bessere Türchen.'}
          </p>
        </div>
      </div>
      {status.pro_tiers && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Pro-Stufen</h2>
          <PlusTiers status={status} kind="pro" />
          <h3 className="mb-3 mt-6 text-base font-semibold">Das bekommst du mit Pro</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {proPerks(status).map((p) => (
              <li key={p.title} className="glass flex gap-3 rounded-2xl p-4">
                <p.icon size={26} className="shrink-0 text-amber-300" aria-hidden />
                <span><b className="block">{p.title}</b><span className="text-sm text-slate-400">{p.text}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <BuyTicker />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Das bekommst du mit Plus</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {plusPerks(status).map((p) => (
            <li key={p.title} className="glass flex gap-3 rounded-2xl p-4">
              <p.icon size={26} className="shrink-0 text-fuchsia-300" aria-hidden />
              <span><b className="block">{p.title}</b><span className="text-sm text-slate-400">{p.text}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
