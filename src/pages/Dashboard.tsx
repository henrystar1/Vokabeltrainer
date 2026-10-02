import { Link } from 'react-router-dom'
import { BookOpen, Brain, ClipboardCheck, Search, Swords, Target, Zap } from 'lucide-react'
import Card from '../components/ui/Card'
import ProgressBar from '../components/ui/ProgressBar'
import { ErrorBox } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useAsync } from '../lib/useAsync'
import { getMyStats, getRecentSessions } from '../services/stats'

const ACTIONS = [
  { to: '/lernen', label: 'Lernen', text: 'Gewichtete Lernrunde starten', icon: Brain },
  { to: '/buecher', label: 'Bücher', text: 'Units, Seiten und Vokabeln verwalten', icon: BookOpen },
  { to: '/test', label: 'Test', text: 'Bereich auswählen und abfragen', icon: ClipboardCheck },
  { to: '/quests', label: 'Quests', text: 'Tagesziele und Lern-Serie', icon: Target },
  { to: '/sprint', label: 'Sprint', text: '60 Sekunden gegen die Uhr', icon: Zap },
  { to: '/duell', label: 'Duelle', text: 'Gemeinsam lernen: Freunde herausfordern', icon: Swords },
  { to: '/suche', label: 'Suche', text: 'Vokabeln in allen Büchern finden', icon: Search },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
}

export default function Dashboard() {
  const { displayName } = useAuth()
  const stats = useAsync(() => getMyStats(null), [])
  const recent = useAsync(() => getRecentSessions(5), [])
  const s = stats.data

  const kpis = [
    { label: 'Heute gelernt', value: s ? String(s.today_vocab) : '—', unit: 'Vokabeln' },
    { label: 'Fortschritt', value: s ? String(Math.round(s.mastery_percent)) : '—', unit: '%' },
    { label: 'Zu wiederholen', value: s ? String(s.due_problem) : '—', unit: 'Vokabeln' },
  ]

  return (
    <div className="space-y-8">
      <header>
        <p className="label-mono">Mission Control</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
          {greeting()}
          {displayName ? `, ${displayName}` : ''}
        </h1>
      </header>

      {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}

      <section className="grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="label-mono">{k.label}</p>
            <p className="mt-3 font-mono text-4xl text-accent-cyan">{k.value}</p>
            <p className="mt-1 text-sm text-slate-400">{k.unit}</p>
          </Card>
        ))}
      </section>

      {s && s.vocab_total > 0 && (
        <Card>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-400">{s.learned} von {s.vocab_total} Vokabeln gelernt</span>
            <span className="font-mono text-accent-cyan">{Math.round(s.mastery_percent)}%</span>
          </div>
          <ProgressBar value={s.mastery_percent} label="Gesamtfortschritt" />
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {recent.data && recent.data.length > 0 && (
        <section>
          <p className="label-mono mb-3">Letzte Runden</p>
          <Card className="p-2">
            <ul className="divide-y divide-white/5">
              {recent.data.map((r) => (
                <li key={r.id} className="flex min-h-[48px] items-center justify-between gap-3 px-3 text-sm">
                  <span>{r.mode === 'learn' ? 'Lernen' : 'Test'}</span>
                  <span className="text-slate-400">{formatWhen(r.started_at)}</span>
                  <span className="font-mono text-accent-cyan">{r.answers_correct}/{r.answers_total}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}
