import { useMemo, useState } from 'react'
import { ListChecks, Play } from 'lucide-react'
import ChoiceResult from '../components/quiz/ChoiceResult'
import ChoiceRunner, { type ChoiceAnswer, type ChoiceQuestion } from '../components/quiz/ChoiceRunner'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listBooks } from '../services/books'
import { getLearningPool } from '../services/learning'
import { getAppSettings } from '../services/koins'
import { buildChoiceQuestions } from '../features/learning/choice'

type Phase = { name: 'setup' } | { name: 'loading' } | { name: 'run'; questions: ChoiceQuestion[] } | { name: 'result'; answers: ChoiceAnswer[] }

/** Multiple Choice: vier Antworten zu deinen Vokabeln. Bringt weniger Coins/Punkte und ändert den Lernstand nicht. */
export default function Practice() {
  const books = useAsync(listBooks, [])
  const rules = useAsync(getAppSettings, [])
  const [bookId, setBookId] = useState('')
  const [count, setCount] = useState(10)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [error, setError] = useState<string | null>(null)
  const every = rules.data?.mc_coin_every ?? 10
  const hint = useMemo(() => `${rules.data?.mc_points_per_answer ?? 1} Punkt pro richtiger Antwort, 1 Coin je ${every} richtige (mit Tageslimit)`, [rules.data, every])

  async function start() {
    setPhase({ name: 'loading' })
    setError(null)
    try {
      const pool = await getLearningPool(null, bookId || null)
      const questions = buildChoiceQuestions(pool, count)
      if (questions.length < 3) {
        setError('Dafür braucht es mindestens 4 aktive Vokabeln mit Übersetzung – aktiviere im Buch mehr Vokabeln oder wähle „Alle Bücher“.')
        setPhase({ name: 'setup' })
        return
      }
      setPhase({ name: 'run', questions })
    } catch (e) {
      setError(errorMessage(e))
      setPhase({ name: 'setup' })
    }
  }

  if (phase.name === 'loading') return <Spinner label="Fragen werden vorbereitet …" />
  if (phase.name === 'run') return <ChoiceRunner questions={phase.questions} title="Multiple Choice" onFinish={(answers) => setPhase({ name: 'result', answers })} onCancel={() => setPhase({ name: 'setup' })} />
  if (phase.name === 'result') return <ChoiceResult answers={phase.answers} onAgain={() => void start()} />

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Üben" title="Multiple Choice" />
      <Card className="space-y-5">
        <p className="flex items-start gap-3 text-sm text-slate-300"><ListChecks className="mt-0.5 shrink-0 text-accent-cyan" size={18} /> Such zu jeder Vokabel die richtige Antwort aus vier Möglichkeiten. Dein Lernstand ändert sich dabei nicht.</p>
        <Field label="Buch">
          <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">Alle Bücher</option>
            {books.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Anzahl Fragen">
          <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Notice tone="info">Belohnung: {hint}. Normales Lernen bringt mehr.</Notice>
        {error && <ErrorBox message={error} />}
        <Button onClick={() => void start()} className="w-full"><Play size={16} /> Starten</Button>
      </Card>
    </div>
  )
}
