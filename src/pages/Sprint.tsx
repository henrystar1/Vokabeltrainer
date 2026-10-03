import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Trophy, Zap } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import QuizRunner from '../components/quiz/QuizRunner'
import ResultSummary, { type WrongAnswer } from '../components/quiz/ResultSummary'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { buildSprintQuestions, type Question } from '../features/learning/questions'
import { LearningSession } from '../features/learning/session'
import { useWallet } from '../features/koins/WalletProvider'
import { getWallet } from '../services/koins'
import { useSettings } from '../features/settings/SettingsProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listBooks } from '../services/books'
import { getLearningPool, submitSession } from '../services/learning'
import { getSprintBoard, submitSprint } from '../services/play'

const SECONDS = 60
type Phase = 'setup' | 'loading' | 'run' | 'result'

/** Sprint-Modus: 60 Sekunden, so viele richtige Antworten wie möglich, ohne Zwischen-Feedback. */
export default function Sprint() {
  const { settings } = useSettings()
  const board = useAsync(getSprintBoard, [])
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState('')
  const language = bookId ? (books.data?.find((b) => b.id === bookId)?.language ?? settings.learn_language) : settings.learn_language
  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const [correct, setCorrect] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [best, setBest] = useState<number | null>(null)
  const [earned, setEarned] = useState(0)
  const wallet = useWallet()
  const session = useRef(new LearningSession(['forward', 'backward']))
  const startedAt = useRef(new Date())
  const wrongRef = useRef<WrongAnswer[]>([])
  const correctRef = useRef(0)
  const answeredRef = useRef(0)

  async function start() {
    setPhase('loading')
    setError(null)
    try {
      // Ohne Buchauswahl zählen alle aktiven Vokabeln aus allen Büchern und Sprachen.
      const pool = await getLearningPool(null, bookId || null)
      const qs = buildSprintQuestions(pool)
      if (qs.length < 5) {
        setError(
          pool.length === 0
            ? 'Hier gibt es keine aktiven Vokabeln. Aktiviere im Buch zuerst welche.'
            : `Für den Sprint brauchst du mindestens 5 Vokabeln mit Übersetzung – hier sind nur ${qs.length}. Wähle „Alle Bücher“ oder ein anderes Buch.`,
        )
        setPhase('setup')
        return
      }
      session.current = new LearningSession(['forward', 'backward'])
      startedAt.current = new Date()
      wrongRef.current = []
      correctRef.current = 0
      answeredRef.current = 0
      setQuestions(qs)
      setPhase('run')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('setup')
    }
  }

  function onAnswer(q: Question, given: string, ok: boolean) {
    session.current.recordMain(q.vocabularyId, q.direction, ok, given)
    answeredRef.current += 1
    if (ok) correctRef.current += 1
    else wrongRef.current.push({ question: q, given })
  }

  async function save(score: number, total: number) {
    setSaveError(null)
    try {
      const r = await submitSprint(score, total)
      setBest(r.best)
      setEarned(r.earned)
      if (r.earned > 0) {
        const b = await getWallet().catch(() => null)
        if (b !== null) wallet.setBalance(b)
      }
      if (total > 0) {
        await submitSession({
          bookId: null,
          mode: 'test',
          affectsLevel: false,
          startedAt: startedAt.current,
          answers: session.current.mainAnswers(),
          levelUpdates: {},
        })
      }
      board.reload()
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  function finish() {
    const score = correctRef.current
    const total = answeredRef.current
    setCorrect(score)
    setAnswered(total)
    setWrong([...wrongRef.current])
    setPhase('result')
    void save(score, total)
  }

  if (phase === 'loading') return <Spinner label="Sprint wird vorbereitet …" />

  if (phase === 'run') {
    return (
      <QuizRunner
        questions={questions}
        caseSensitive={settings.case_sensitive}
        accents={language === 'fr'}
        title="Sprint"
        showFeedback={false}
        timeLimitSeconds={SECONDS}
        onAnswer={onAnswer}
        onFinish={finish}
        onCancel={() => setPhase('setup')}
      />
    )
  }

  if (phase === 'result') {
    return (
      <div>
        <PageHeader eyebrow="Sprint" title={`${correct} richtig`} />
        <ResultSummary total={answered} correct={correct} wrong={wrong} />
        <div className="mt-4 space-y-3">
          {earned > 0 && <Notice tone="ok">+{earned} Coins für deinen Sprint!</Notice>}
          {best !== null && <p className="text-sm text-slate-300">Deine Bestleistung diese Woche: <span className="font-mono text-accent-cyan">{best}</span></p>}
          {saveError && <ErrorBox message={`Das Ergebnis konnte nicht gespeichert werden: ${saveError}`} onRetry={() => void save(correct, answered)} />}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => void start()}>
            <Play size={18} /> Nochmal
          </Button>
          <Link to="/quests" className="inline-flex min-h-[44px] items-center px-4 text-slate-400 hover:text-white">
            Zu den Quests
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Wettlauf gegen die Zeit" title="Sprint" />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <Zap className="text-accent-violet" size={28} />
          <p className="text-slate-300">
            Du hast <span className="font-mono text-accent-cyan">{SECONDS} Sekunden</span>. Beantworte so viele Vokabeln richtig wie möglich – ohne Rückmeldung nach jeder Antwort. Falsche Antworten kosten nichts, aber Zeit. Für jede richtige Runde gibt es Coins (begrenzt pro Tag).
          </p>
          <Field label="Vokabeln aus">
            <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Alle meine Bücher</option>
              {books.data?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-slate-400">Beide Richtungen gemischt. Dein Lernstand ändert sich nicht.</p>
          <Button className="w-full min-h-[52px]" onClick={() => void start()}>
            <Play size={18} /> Sprint starten
          </Button>
        </Card>
        <Card className="p-2">
          <h2 className="flex items-center gap-2 px-4 pb-2 pt-3 font-semibold"><Trophy size={18} className="text-amber-300" /> Beste Sprints dieser Woche</h2>
          {board.loading && !board.data && <Spinner />}
          {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
          {board.data && board.data.length === 0 && <p className="px-4 pb-4 text-sm text-slate-400">Noch kein Sprint diese Woche – sei der Erste!</p>}
          <ol>
            {board.data?.slice(0, 15).map((r) => (
              <li key={`${r.rank}-${r.display_name}`} className={`flex min-h-[48px] items-center gap-3 rounded-xl px-4 ${r.is_me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : ''}`}>
                <span className="w-6 text-center font-mono text-slate-500">{r.rank}</span>
                <span className="min-w-0 flex-1"><PlayerTag name={r.display_name} cosmetics={r} framed size={32} /></span>
                <span className="font-mono text-accent-cyan">{r.score}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
