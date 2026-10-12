import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, FileText, Lock, Play, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import TestSheet from '../components/sheet/TestSheet'
import SavedResult from '../components/sheet/SavedResult'
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
import { usePlus } from '../features/plus/PlusProvider'
import { deleteResult, generateSentences, getResult, LEVELS, myResults, type Lang, type Level, type StoredResult } from '../services/ai'
import type { GapItem } from '../lib/gaps'
import { formatDateTime } from '../lib/format'
import { GRADE_WORD, gradeFromScore } from '../lib/grade'

type Phase = 'setup' | 'loading' | 'run' | 'result' | 'sheet'

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
  const plus = usePlus()
  const [style, setStyle] = useState<'quiz' | 'sheet'>('quiz')
  const [withSentences, setWithSentences] = useState(false)
  const [sLevel, setSLevel] = useState<Level>('mittel')
  const [sentences, setSentences] = useState<GapItem[]>([])
  const [sheetNotice, setSheetNotice] = useState<string | null>(null)
  const [opened, setOpened] = useState<StoredResult | null>(null)
  const history = useAsync(() => myResults('test'), [])
  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const [correct, setCorrect] = useState(0)

  const directions = useMemo(() => activeDirections(settings), [settings])
  const language = books.data?.find((b) => b.id === bookId)?.language ?? settings.learn_language
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
      if (style === 'sheet') {
        let extra: GapItem[] = []
        let note: string | null = null
        if (withSentences && plus.active && (language === 'en' || language === 'fr')) {
          const max = plus.status?.test_sentences ?? 20
          const r = await generateSentences({
            language: language as Lang,
            level: sLevel,
            vocab: vocabInRange.filter((v) => v.translations.length > 0).slice(0, max).map((v) => ({ foreign: v.translations[0], german: v.german })),
          })
          if (r.ok) {
            extra = r.sentences.flatMap((x) => (x.item ? [{ text: x.item.text, answers: [x.item.answers], hints: [x.item.hint || x.german], explanation: '' }] : []))
            if (r.partial) note = 'Zu einigen Vokabeln gab es keinen Satz, sie stehen nur im Vokabelteil.'
          } else {
            note = `Die Sätze konnten nicht erstellt werden (${r.message}). Der Test enthält nur Vokabeln.`
          }
        }
        setSentences(extra)
        setSheetNotice(note)
        setQuestions(qs)
        setPhase('sheet')
        return
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

  if (phase === 'sheet') {
    const bookName = books.data?.find((b) => b.id === bookId)?.name ?? 'Test'
    return (
      <div>
        <PageHeader eyebrow="Test-Blatt" title={bookName} />
        <TestSheet
          title={`Test: ${bookName}`}
          language={language}
          level={sentences.length > 0 ? sLevel : ''}
          questions={questions}
          sentences={sentences}
          notice={sheetNotice}
          caseSensitive={settings.case_sensitive}
          onExit={() => { setPhase('setup'); history.reload() }}
        />
      </div>
    )
  }

  if (phase === 'run') {
    return (
      <QuizRunner
        questions={questions}
        caseSensitive={settings.case_sensitive}
        showFeedback={false}
        accents={language === 'fr'}
        title="Test"
        onAnswer={onAnswer}
        onFinish={() => void finish()}
        onCancel={() => setPhase('setup')}
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
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Art des Tests">
          {([['quiz', 'Abfrage', ClipboardCheck], ['sheet', 'Blatt mit Note', FileText]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" aria-pressed={style === id} onClick={() => setStyle(id)}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border text-sm transition ${style === id ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {style === 'sheet' && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-space-900/40 p-3">
            <p className="text-sm text-slate-400">Alle Vokabeln stehen auf einem Blatt zum Ausfüllen. Am Ende bekommst du eine Note, und der Test wird gespeichert.</p>
            <button type="button" onClick={() => { if (!plus.active) plus.openDialog(); else setWithSentences((w) => !w) }}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-white/5" aria-pressed={withSentences && plus.active}>
              <span className={`flex h-5 w-5 items-center justify-center rounded border ${withSentences && plus.active ? 'border-fuchsia-400 bg-fuchsia-500/30' : 'border-white/30'}`}>{withSentences && plus.active ? '✓' : ''}</span>
              <span className="flex-1">Sätze zu den Vokabeln einbauen</span>
              {!plus.active && <span className="plus-nav inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-fuchsia-300"><Lock size={12} /> Plus</span>}
            </button>
            {withSentences && plus.active && (
              <Field label="Schwierigkeit der Sätze">
                <Select value={sLevel} onChange={(e) => setSLevel(e.target.value as Level)}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </Field>
            )}
          </div>
        )}
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
              {directions.length === 2 ? ' (erst Fremdsprache → Deutsch, dann zurück)' : ''}
            </p>
            {style === 'quiz' && <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-white/10 bg-space-900/50 px-4 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={affectsLevel} onChange={(e) => setAffectsLevel(e.target.checked)} />
              Ergebnis soll den Lernstand verändern
            </label>}
            <Button className="w-full min-h-[52px]" disabled={vocabInRange.length === 0} onClick={() => void start()}>
              <Play size={18} /> {style === 'sheet' ? 'Blatt erstellen' : 'Test starten'}
            </Button>
          </>
        )}
      </Card>

      <section className="mx-auto mt-8 max-w-xl space-y-3">
        <h2 className="text-lg font-semibold">Meine Tests</h2>
        {opened ? (
          <>
            <Button variant="ghost" className="no-print" onClick={() => setOpened(null)}>← Alle Tests</Button>
            <SavedResult result={opened} />
          </>
        ) : (
          <>
            {history.loading && !history.data && <Spinner />}
            {history.data?.length === 0 && <p className="text-sm text-slate-500">Noch kein Test-Blatt abgegeben. Wähle oben „Blatt mit Note“.</p>}
            <ul className="space-y-2">
              {history.data?.map((r) => (
                <li key={r.id} className="glass flex items-center gap-2 rounded-2xl p-2">
                  <button type="button" className="flex min-h-[52px] min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 text-left hover:bg-white/5" onClick={() => void getResult(r.id).then(setOpened).catch((e) => setError(errorMessage(e)))}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block text-xs text-slate-500">{formatDateTime(r.created_at)} · {r.score}/{r.total} · {GRADE_WORD[gradeFromScore(r.score, r.total)]}</span>
                    </span>
                    <span className="font-mono text-2xl text-accent-cyan">{gradeFromScore(r.score, r.total)}</span>
                  </button>
                  <button type="button" aria-label="Löschen" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-rose-300" onClick={() => { if (window.confirm('Diesen Test löschen?')) void deleteResult(r.id).then(history.reload).catch((e) => setError(errorMessage(e))) }}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
