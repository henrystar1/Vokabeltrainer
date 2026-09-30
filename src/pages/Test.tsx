import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Play } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import QuizRunner from '../components/quiz/QuizRunner'
import ResultSummary, { type WrongAnswer } from '../components/quiz/ResultSummary'
import { buildTestQuestions, type Question } from '../features/learning/questions'
import { LearningSession } from '../features/learning/session'
import { useSettings } from '../features/settings/SettingsProvider'
import { activeDirections } from '../features/settings/rules'
import { distinctVocabulary, selectRange, type RangeMode } from '../features/test/range'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getBookEntries, listBooks } from '../services/books'
import { getLearningPool, submitSession } from '../services/learning'
import type { BookEntry } from '../types'

type Phase = 'setup' | 'loading' | 'run' | 'result'

const MODE_LABEL: Record<RangeMode, string> = { vocab: 'Vokabelnummer', page: 'Seite', unit: 'Unit' }

function bounds(entries: BookEntry[], mode: RangeMode): [number, number] {
  if (entries.length === 0) return [1, 1]
  const values = entries.map((e) => (mode === 'vocab' ? e.order : mode === 'page' ? e.page_number : e.unit_number))
  return [Math.min(...values), Math.max(...values)]
}

export default function Test() {
  const [params] = useSearchParams()
  const { settings } = useSettings()
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState(params.get('buch') ?? '')
  const entries = useAsync(() => (bookId ? getBookEntries(bookId) : Promise.resolve([] as BookEntry[])), [bookId])
  const [mode, setMode] = useState<RangeMode>('unit')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [affectsLevel, setAffectsLevel] = useState(false)
  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const [correct, setCorrect] = useState(0)

  const directions = useMemo(() => activeDirections(settings), [settings])
  const session = useRef(new LearningSession(directions))
  const levels = useRef<Record<string, number>>({})
  const startedAt = useRef(new Date())
  const wrongRef = useRef<WrongAnswer[]>([])
  const correctRef = useRef(0)

  const all = useMemo(() => entries.data ?? [], [entries.data])
  const [lo, hi] = bounds(all, mode)
  const fromN = Number.parseInt(from, 10)
  const toN = Number.parseInt(to, 10)
  const effFrom = Number.isInteger(fromN) ? fromN : lo
  const effTo = Number.isInteger(toN) ? toN : hi
  const inRange = useMemo(() => selectRange(all, { mode, from: effFrom, to: effTo }), [all, mode, effFrom, effTo])
  const vocabInRange = useMemo(() => distinctVocabulary(inRange), [inRange])

  async function start() {
    setPhase('loading')
    setError(null)
    setSaveError(null)
    try {
      const qs = buildTestQuestions(vocabInRange, distinctVocabulary(all), { directions })
      if (qs.length === 0) {
        setError('Im gewählten Bereich gibt es keine Vokabeln.')
        setPhase('setup')
        return
      }
      if (affectsLevel) {
        const pool = await getLearningPool(null, bookId)
        levels.current = Object.fromEntries(pool.map((v) => [v.vocabulary_id, v.level]))
      }
      session.current = new LearningSession(directions)
      startedAt.current = new Date()
      wrongRef.current = []
      correctRef.current = 0
      setQuestions(qs)
      setPhase('run')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('setup')
    }
  }

  function onAnswer(q: Question, given: string, ok: boolean) {
    session.current.recordMain(q.vocabularyId, q.direction, ok, given)
    if (ok) correctRef.current += 1
    else wrongRef.current.push({ question: q, given })
  }

  async function save() {
    setSaveError(null)
    try {
      await submitSession({
        bookId,
        mode: 'test',
        affectsLevel,
        startedAt: startedAt.current,
        answers: session.current.mainAnswers(),
        levelUpdates: affectsLevel ? session.current.levelUpdates(levels.current) : {},
      })
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  async function finish() {
    setWrong([...wrongRef.current])
    setCorrect(correctRef.current)
    setPhase('result')
    await save()
  }

  if (phase === 'loading') return <Spinner label="Test wird vorbereitet …" />

  if (phase === 'run') {
    return (
      <QuizRunner
        questions={questions}
        caseSensitive={settings.case_sensitive}
        showFeedback={false}
        title="Test"
        onAnswer={onAnswer}
        onFinish={() => void finish()}
      />
    )
  }

  if (phase === 'result') {
    return (
      <div>
        <PageHeader eyebrow="Test" title="Auswertung" />
        <ResultSummary total={questions.length} correct={correct} wrong={wrong} />
        <div className="mt-4 space-y-3">
          <Notice tone="info">{affectsLevel ? 'Dieser Test hat deinen Lernstand verändert.' : 'Dieser Test hat deinen Lernstand nicht verändert.'}</Notice>
          {saveError && <ErrorBox message={`Der Test konnte nicht gespeichert werden: ${saveError}`} onRetry={() => void save()} />}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => setPhase('setup')}>
            <ClipboardCheck size={18} /> Neuer Test
          </Button>
          <Link to="/" className="inline-flex min-h-[44px] items-center px-4 text-slate-400 hover:text-white">
            Zur Startseite
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Prüfungsmodus" title="Test" />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <Card className="mx-auto max-w-xl space-y-5">
        <Field label="Buch">
          <Select value={bookId} onChange={(e) => { setBookId(e.target.value); setFrom(''); setTo('') }}>
            <option value="">Buch wählen …</option>
            {books.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        {bookId && entries.loading && <Spinner />}
        {entries.error && <ErrorBox message={entries.error} onRetry={entries.reload} />}
        {bookId && !entries.loading && all.length === 0 && !entries.error && (
          <EmptyState title="Dieses Buch hat noch keine Vokabeln" />
        )}

        {bookId && all.length > 0 && (
          <>
            <Field label="Bereich nach …">
              <Select value={mode} onChange={(e) => { setMode(e.target.value as RangeMode); setFrom(''); setTo('') }}>
                {(Object.keys(MODE_LABEL) as RangeMode[]).map((m) => (
                  <option key={m} value={m}>{MODE_LABEL[m]}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Von">
                <TextInput inputMode="numeric" placeholder={String(lo)} value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Bis">
                <TextInput inputMode="numeric" placeholder={String(hi)} value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <p className="text-sm text-slate-400">
              {vocabInRange.length} Vokabeln im Bereich → {vocabInRange.length * directions.length} Abfragen
              {directions.length === 2 ? ' (erst Deutsch → Fremdsprache, dann zurück)' : ''}
            </p>
            <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-white/10 bg-space-900/50 px-4 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={affectsLevel} onChange={(e) => setAffectsLevel(e.target.checked)} />
              Ergebnis soll den Lernstand verändern
            </label>
            <Button className="w-full min-h-[52px]" disabled={vocabInRange.length === 0} onClick={() => void start()}>
              <Play size={18} /> Test starten
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
