import { useState } from 'react'
import Card from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import HistoryChart from '../components/charts/HistoryChart'
import LevelBars from '../components/charts/LevelBars'
import ProgressRing from '../components/charts/ProgressRing'
import { useAsync } from '../lib/useAsync'
import { listBooks } from '../services/books'
import { getAppSettings } from '../services/koins'
import { getCommunity, getMyStats } from '../services/stats'

function Kpi({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <Card>
      <p className="label-mono">{label}</p>
      <p className="mt-3 font-mono text-3xl text-accent-cyan">{value}</p>
      {unit && <p className="mt-1 text-sm text-slate-400">{unit}</p>}
    </Card>
  )
}

export default function Stats() {
  const [bookId, setBookId] = useState('')
  const books = useAsync(listBooks, [])
  const stats = useAsync(() => getMyStats(bookId || null), [bookId])
  const community = useAsync(getCommunity, [])
  const rules = useAsync(getAppSettings, [])
  const s = stats.data
  const c = community.data

  return (
    <div>
      <PageHeader
        eyebrow="Analyse"
        title="Statistik"
        actions={
          <Select aria-label="Buch filtern" value={bookId} onChange={(e) => setBookId(e.target.value)} className="min-w-[200px]">
            <option value="">Alle Bücher</option>
            {books.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        }
      />
      {stats.loading && !s && <Spinner />}
      {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}
      {s && s.vocab_total === 0 && <EmptyState title="Noch keine Daten" text="Lege Vokabeln an und starte eine Lernrunde." />}
      {s && s.vocab_total > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="flex items-center justify-center">
              <ProgressRing value={s.mastery_percent} label="Fortschritt" />
            </Card>
            <Kpi label="Gelernt (ab Stufe 2)" value={`${s.learned} / ${s.vocab_total}`} unit="Vokabeln" />
            <Kpi label="Trefferquote" value={s.accuracy_percent === null ? '—' : `${Math.round(s.accuracy_percent)}%`} unit={`${s.answers_correct} von ${s.answers_total} Antworten`} />
            <Kpi label="Zu wiederholen" value={s.due_problem} unit="Vokabeln mit Fehlern auf Stufe 1" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="label-mono mb-4">Lernstufen</p>
              <LevelBars counts={s.level_counts} gaps={rules.data ?? undefined} />
            </Card>
            <Card>
              <p className="label-mono mb-4">Antworten pro Tag</p>
              <HistoryChart days={s.history} />
              <p className="mt-3 text-xs text-slate-500">Hell: alle Antworten · Cyan: davon richtig</p>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Kpi label="Heute" value={s.today_answers} unit={`Antworten · ${s.today_vocab} Vokabeln`} />
            <Kpi label="Diese Woche" value={s.week_answers} unit={`Antworten · ${s.week_vocab} Vokabeln`} />
            <Card className="sm:col-span-2">
              <p className="label-mono">Community</p>
              {c && c.learners >= 3 && c.avg_accuracy_percent !== null ? (
                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400">Ø Trefferquote</p>
                    <p className="font-mono text-2xl text-accent-violet">{Math.round(c.avg_accuracy_percent)}%</p>
                    <p className="text-xs text-slate-500">Du: {s.accuracy_percent === null ? '—' : `${Math.round(s.accuracy_percent)}%`}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Ø gelernte Vokabeln</p>
                    <p className="font-mono text-2xl text-accent-violet">{Math.round(c.avg_learned_vocabulary ?? 0)}</p>
                    <p className="text-xs text-slate-500">Du: {s.learned}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Der Vergleich erscheint, sobald mindestens 3 Lernende aktiv waren. Es werden nur Durchschnittswerte angezeigt.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
