import { Link } from 'react-router-dom'
import { BookOpen, Brain, ClipboardCheck } from 'lucide-react'
import Card from '../components/ui/Card'

// Platzhalterwerte – werden in Phase 9 durch echte Statistik ersetzt.
const KPIS = [
  { label: 'Heute lernen', value: '—', unit: 'Vokabeln' },
  { label: 'Fortschritt', value: '—', unit: '%' },
  { label: 'Zu wiederholen', value: '—', unit: 'Vokabeln' },
]

const ACTIONS = [
  { to: '/lernen', label: 'Lernen', text: 'Gewichtete Lernrunde starten', icon: Brain },
  { to: '/buecher', label: 'Bücher', text: 'Units, Seiten und Vokabeln verwalten', icon: BookOpen },
  { to: '/test', label: 'Test', text: 'Bereich auswählen und abfragen', icon: ClipboardCheck },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <header>
        <p className="label-mono">Mission Control</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{greeting()}</h1>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <p className="label-mono">{k.label}</p>
            <p className="mt-3 font-mono text-4xl text-accent-cyan">{k.value}</p>
            <p className="mt-1 text-sm text-slate-400">{k.unit}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {ACTIONS.map(({ to, label, text, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card interactive className="h-full min-h-[150px]">
              <Icon className="text-accent-violet" size={26} />
              <h2 className="mt-5 text-xl font-semibold">{label}</h2>
              <p className="mt-1 text-sm text-slate-400">{text}</p>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  )
}
