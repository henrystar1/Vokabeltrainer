import { Link } from 'react-router-dom'
import { Eye, Footprints, ShoppingBag, Skull, Users } from 'lucide-react'
import { useRunPerks } from '../features/parkour/perks'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'

export default function Parkour() {
  const perks = useRunPerks()

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Spaß" title="Parkour" />
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <Footprints className="mt-1 shrink-0 text-accent-cyan" size={22} />
          <p className="text-sm text-slate-300">
            Mit bis zu 5 Leuten per Joystick durch Level voller Stacheln, Türen und Brücken. Gemeinsame Herzen, Checkpoints, Coins je nach Fortschritt und eine Bestenliste für Teams. Nach Level 8 gibt es endlos neue Zufallslevel.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/live-duell?modus=team" className="btn-primary inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 font-semibold">
            <Users size={18} /> Team-Parkour
          </Link>
          <Link to="/live-duell?modus=team&art=deathrun" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 font-semibold text-rose-200 hover:bg-rose-500/20">
            <Skull size={18} /> Deathrun
          </Link>
        </div>
        <Link to="/deathrun" className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 font-semibold text-amber-100 hover:bg-amber-400/20">
          <Skull size={18} /> Offene Deathrun-Lobby: sofort mitspielen
        </Link>
        {perks.spectate && (
          <Link to="/laeufe" className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-violet-300/40 bg-violet-400/10 px-4 text-sm font-semibold text-violet-100 hover:bg-violet-400/20">
            <Eye size={16} /> Alle laufenden Läufe ansehen
          </Link>
        )}
        <p className="text-xs text-slate-400">
          <b>Deathrun:</b> bis zu 5 Personen, jeder läuft für sich mit eigenen Herzen und kommt allein ins nächste Level, sobald er im Ziel ist. Tore und Brücken gehen nur mit Teamarbeit auf. Wer keine Herzen mehr hat, scheidet aus. Bestenlisten findest du unter <Link to="/rangliste" className="text-accent-cyan hover:underline">Rangliste</Link>.
        </p>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-[12rem] flex-1 text-sm text-slate-300">Herzen, Farben, Hüte, Effekte und Auftritte gibt es jetzt im Shop.</p>
        <Link to="/shop?tab=parkour" className="btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 font-semibold"><ShoppingBag size={18} /> Zum Parkour-Shop</Link>
      </Card>
    </div>
  )
}
