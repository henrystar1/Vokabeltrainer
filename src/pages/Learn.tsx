import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronsRight, Play, RotateCcw, Settings as SettingsIcon } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import QuizRunner from '../components/quiz/QuizRunner'
import ResultSummary, { type WrongAnswer } from '../components/quiz/ResultSummary'
import { buildLearningQuestions, buildMistakeQuestions, type Question } from '../features/learning/questions'
import { LearningSession } from '../features/learning/session'
import { useSettings } from '../features/settings/SettingsProvider'
import { activeDirections } from '../features/settings/rules'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listBooks } from '../services/books'
import { useWallet } from '../features/koins/WalletProvider'
import { getWallet } from '../services/koins'
import { activateNextPage } from '../services/community'
import { getMistakePool } from '../services/play'
import { getAppSettings } from '../services/koins'
import { addRepeatAnswers, getLearningPool, submitSession } from '../services/learning'
import PlusHint from '../features/plus/PlusHint'
import { usePlus } from '../features/plus/PlusProvider'
import { plusMakeDue } from '../services/plus'
import PageRules from '../components/admin/PageRules'

type Phase = 'setup' | 'loading' | 'main' | 'result' | 'repeat' | 'repeat-result'

export default function Learn() {
  const [params] = useSearchParams()
  const { settings } = useSettings()
  const wallet = useWallet()
  const plus = usePlus()
  const [dueBusy, setDueBusy] = useState(false)
  const [dueMsg, setDueMsg] = useState<string | null>(null)
  const balanceAtStart = useRef(0)
  const [earned, setEarned] = useState(0)
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState(params.get('buch') ?? '')
  const [mistakeMode, setMistakeMode] = useState(params.get('modus') === 'fehler')
  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const [correctCount, setCorrectCount] = useState(0)
  const [levelChanges, setLevelChanges] = useState<{ up: number; down: number } | null>(null)
  const [repeatWrong, setRepeatWrong] = useState<WrongAnswer[]>([])
  const [repeatCorrect, setRepeatCorrect] = useState(0)
  const [repeatSaved, setRepeatSaved] = useState(true)
  const [repeatRound, setRepeatRound] = useState(1)
  /** Wie viele automatische Wiederholungsrunden waren nötig (0 = Funktion aus oder keine Fehler). */
  const [autoRounds, setAutoRounds] = useState(0)
  const [mainTotal, setMainTotal] = useState(0)

  const directions = useMemo(() => activeDirections(settings), [settings])
  const language = bookId ? (books.data?.find((b) => b.id === bookId)?.language ?? settings.learn_language) : settings.learn_language
  const session = useRef(new LearningSession(directions))
  const levels = useRef<Record<string, number>>({})
  const sessionId = useRef<string | null>(null)
  const startedAt = useRef(new Date())
  const wrongRef = useRef<WrongAnswer[]>([])
  const correctRef = useRef(0)
  const repeatWrongRef = useRef<WrongAnswer[]>([])
  const repeatCorrectRef = useRef(0)
  const savedRepeat = useRef(0)
  const mainSave = useRef<Promise<void>>(Promise.resolve())

  const selected = bookId ? books.data?.find((b) => b.id === bookId) : undefined
  const [unlocking, setUnlocking] = useState(false)
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null)

  async function unlockNext() {
    setUnlocking(true)
    setUnlockMsg(null)
    try {
      const r = await activateNextPage(bookId)
      setUnlockMsg(r ? `Unit ${r.unit_number}, Seite ${r.page_number} freigeschaltet (${r.count} Vokabeln).` : 'Alles ist schon aktiv.')
      books.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUnlocking(false)
    }
  }

  async function start() {
    setPhase('loading')
    setError(null)
    setSaveError(null)
    try {
      balanceAtStart.current = wallet.balance
      setEarned(0)
      const pool = mistakeMode
        ? await getMistakePool(bookId || null)
        : await getLearningPool(bookId ? null : settings.learn_language, bookId || null)
      levels.current = Object.fromEntries(pool.map((v) => [v.vocabulary_id, v.level]))
      const build = mistakeMode ? buildMistakeQuestions : buildLearningQuestions
      const rules = await getAppSettings().catch(() => ({}) as Record<string, number>)
      const gapMinutes = [rules.learn_gap_l1 ?? 0, rules.learn_gap_l2 ?? 0, rules.learn_gap_l3 ?? 0, rules.learn_gap_l4 ?? 0]
      const qs = build(pool, { directions, questionCount: settings.words_per_round, gapMinutes })
      if (qs.length === 0) {
        setError(mistakeMode ? 'Keine Fehler in den letzten 30 Tagen – es gibt nichts zu trainieren. Starke Leistung!' : pool.length === 0 ? 'Hier gibt es keine aktiven Vokabeln. Aktiviere im Buch zuerst Vokabeln (Seite „Buch“ → „Vokabeln aktivieren“) oder trage welche ein.' : (pool.some((v) => v.level < 5) ? 'Alle fälligen Vokabeln sind noch in der Wartezeit – komm später wieder, dann sitzen sie besser. (Die Wartezeiten stellt ein Admin ein.)' : 'Alle Vokabeln sind schon auf Stufe 5 – es gibt gerade nichts zu lernen. Stark!'))
        setPhase('setup')
        return
      }
      session.current = new LearningSession(directions)
      sessionId.current = null
      startedAt.current = new Date()
      wrongRef.current = []
      correctRef.current = 0
      setQuestions(qs)
      setPhase('main')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('setup')
    }
  }

  function onMainAnswer(q: Question, given: string, correct: boolean) {
    session.current.recordMain(q.vocabularyId, q.direction, correct, given)
    if (correct) correctRef.current += 1
    else wrongRef.current.push({ question: q, given })
  }

  /** „Hab ich gewusst“: die zuletzt falsche Antwort zu dieser Frage zählt nachträglich als richtig. */
  function forgiveMain(q: Question, given: string) {
    session.current.recordMain(q.vocabularyId, q.direction, true, given)
    const i = wrongRef.current.map((w) => w.question.id).lastIndexOf(q.id)
    if (i >= 0) wrongRef.current.splice(i, 1)
    correctRef.current += 1
  }

  function forgiveRepeat(q: Question, given: string) {
    session.current.recordRepeat(q.vocabularyId, q.direction, true, given)
    const i = repeatWrongRef.current.map((w) => w.question.id).lastIndexOf(q.id)
    if (i >= 0) repeatWrongRef.current.splice(i, 1)
    repeatCorrectRef.current += 1
  }

  async function saveMain() {
    setSaveError(null)
    try {
      const updates = session.current.levelUpdates(levels.current)
      let up = 0
      let down = 0
      for (const [id, lvl] of Object.entries(updates)) {
        const before = levels.current[id] ?? 1
        if (lvl > before) up++
        else if (lvl < before) down++
      }
      setLevelChanges({ up, down })
      sessionId.current = await submitSession({
        bookId: bookId || null,
        mode: 'learn',
        affectsLevel: true,
        startedAt: startedAt.current,
        answers: session.current.mainAnswers(),
        levelUpdates: updates,
      })
      const b = await getWallet().catch(() => null)
      if (b !== null) {
        wallet.setBalance(b)
        setEarned(Math.max(0, b - balanceAtStart.current))
      }
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  async function finishMain() {
    setWrong([...wrongRef.current])
    setCorrectCount(correctRef.current)
    setMainTotal(questions.length)
    savedRepeat.current = 0
    setAutoRounds(0)
    mainSave.current = saveMain()
    if (settings.repeat_until_correct && wrongRef.current.length > 0) {
      // Direkt weiter: die falschen Fragen kommen so lange dran, bis alle richtig waren.
      startRepeat([...wrongRef.current], 1)
    } else {
      setPhase('result')
    }
    await mainSave.current
  }

  function startRepeat(list: WrongAnswer[], round = 1) {
    // Nur die falsch beantworteten Fragen, neu gemischt.
    const qs = [...list.map((w) => w.question)].sort(() => Math.random() - 0.5)
    repeatWrongRef.current = []
    repeatCorrectRef.current = 0
    setRepeatRound(round)
    setQuestions(qs)
    setPhase('repeat')
  }

  /** Speichert die Wiederholungs-Antworten, die noch nicht gespeichert sind (erst wenn die Hauptrunde gespeichert ist). */
  async function flushRepeat() {
    await mainSave.current
    if (!sessionId.current) return
    const fresh = session.current.repeatAnswers().slice(savedRepeat.current)
    if (fresh.length === 0) return
    try {
      setRepeatSaved(false)
      await addRepeatAnswers(sessionId.current, fresh)
      savedRepeat.current += fresh.length
      setRepeatSaved(true)
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  function onRepeatAnswer(q: Question, given: string, correct: boolean) {
    session.current.recordRepeat(q.vocabularyId, q.direction, correct, given)
    if (correct) repeatCorrectRef.current += 1
    else repeatWrongRef.current.push({ question: q, given })
  }

  async function finishRepeat() {
    const stillWrong = [...repeatWrongRef.current]
    if (settings.repeat_until_correct) {
      if (stillWrong.length > 0) {
        startRepeat(stillWrong, repeatRound + 1)
        await flushRepeat()
        return
      }
      // Alles war richtig: zurück zur Auswertung der Hauptrunde.
      setAutoRounds(repeatRound)
      setPhase('result')
      await flushRepeat()
      return
    }
    setRepeatWrong(stillWrong)
    setRepeatCorrect(repeatCorrectRef.current)
    setPhase('repeat-result')
    await flushRepeat()
  }

  if (phase === 'loading') return <Spinner label="Lernrunde wird vorbereitet …" />

  if (phase === 'main' || phase === 'repeat') {
    return (
      <QuizRunner
        key={`${phase}-${repeatRound}`}
        questions={questions}
        caseSensitive={settings.case_sensitive}
        accents={language === 'fr'}
        title={phase === 'repeat' ? (settings.repeat_until_correct ? `Fehler wiederholen · Runde ${repeatRound}` : 'Fehler wiederholen') : mistakeMode ? 'Fehler-Training' : 'Lernrunde'}
        onAnswer={phase === 'repeat' ? onRepeatAnswer : onMainAnswer}
        onForgive={phase === 'repeat' ? forgiveRepeat : forgiveMain}
        onFinish={() => void (phase === 'repeat' ? finishRepeat() : finishMain())}
        onCancel={() => setPhase('setup')}
      />
    )
  }

  if (phase === 'result') {
    return (
      <div>
        <PageHeader eyebrow={mistakeMode ? 'Fehler-Training' : 'Lernrunde'} title="Geschafft" />
        <ResultSummary total={mainTotal || questions.length} correct={correctCount} wrong={wrong} />
        <div className="mt-4 space-y-3">
          {levelChanges && (
            <Notice tone="info">
              Lernstand: {levelChanges.up} Vokabeln aufgestiegen, {levelChanges.down} abgestiegen.
            </Notice>
          )}
          {autoRounds > 0 && <Notice tone="ok">Alle falschen Vokabeln wiederholt, bis sie richtig waren ({autoRounds} {autoRounds === 1 ? 'Runde' : 'Runden'}).</Notice>}
          {earned > 0 && <Notice tone="info">+{earned} Coins fürs Lernen – gut gemacht!</Notice>}
          {saveError && <ErrorBox message={`Die Runde konnte nicht gespeichert werden: ${saveError}`} onRetry={() => void saveMain()} />}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {wrong.length > 0 && autoRounds === 0 && (
            <Button onClick={() => startRepeat(wrong)} disabled={!sessionId.current && !saveError}>
              <RotateCcw size={18} /> Fehler wiederholen
            </Button>
          )}
          <Button variant="secondary" onClick={() => void start()}>
            <Play size={18} /> Neue Runde
          </Button>
          <Link to="/" className="inline-flex min-h-[44px] items-center px-4 text-slate-400 hover:text-white">
            Zur Startseite
          </Link>
        </div>
      </div>
    )
  }

  if (phase === 'repeat-result') {
    return (
      <div>
        <PageHeader eyebrow="Wiederholung" title="Fehler wiederholt" />
        <ResultSummary total={questions.length} correct={repeatCorrect} wrong={repeatWrong} />
        <div className="mt-4 space-y-3">
          <Notice tone="info">Die Wiederholung verändert deinen Lernstand nicht.</Notice>
          {!repeatSaved && !saveError && <Spinner label="Speichert …" />}
          {saveError && <ErrorBox message={saveError} />}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {repeatWrong.length > 0 && (
            <Button onClick={() => startRepeat(repeatWrong)}>
              <RotateCcw size={18} /> Restliche Fehler nochmal
            </Button>
          )}
          <Button variant="secondary" onClick={() => void start()}>
            <Play size={18} /> Neue Runde
          </Button>
        </div>
      </div>
    )
  }

  const bothDirs = directions.length === 2

  async function makeDue() {
    if (!plus.active) { plus.openDialog(); return }
    setDueBusy(true)
    setDueMsg(null)
    setError(null)
    try {
      const n = await plusMakeDue(bookId || null)
      setDueMsg(n > 0 ? `${n} gelernte Vokabeln sind wieder fällig.` : 'Es gab keine gelernten Vokabeln, die man wieder fällig machen kann.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setDueBusy(false)
    }
  }
  return (
    <div>
      <PageHeader eyebrow="Trainingsraum" title="Lernen" />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <Card className="mx-auto max-w-xl space-y-5">
        <div role="tablist" className="glass inline-flex w-full rounded-xl p-1">
          {([[false, 'Normal lernen'], [true, 'Fehler-Training']] as const).map(([m, label]) => (
            <button
              key={label}
              role="tab"
              aria-selected={mistakeMode === m}
              onClick={() => setMistakeMode(m)}
              className={`min-h-[40px] flex-1 rounded-lg px-3 text-sm font-medium transition ${mistakeMode === m ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mistakeMode && (
          <p className="text-sm text-slate-400">
            Hier kommen nur Vokabeln dran, die du in den letzten 30 Tagen falsch hattest – die schwersten zuerst. Dein Lernstand wird wie sonst angepasst.
          </p>
        )}
        <Field label="Was möchtest du lernen?">
          <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">Alle Bücher ({settings.learn_language.toUpperCase()})</option>
            {books.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        <div className="rounded-xl border border-white/10 bg-space-900/50 p-4 text-sm text-slate-300">
          <p>
            <span className="font-mono text-accent-cyan">{settings.words_per_round}</span> Abfragen
            {bothDirections(bothDirs, settings.words_per_round)}
          </p>
          <p className="mt-1 text-slate-400">
            {directions.map((d) => (d === 'forward' ? 'Deutsch → Fremdsprache' : 'Fremdsprache → Deutsch')).join(' + ')}
            {settings.case_sensitive ? ' · Groß-/Kleinschreibung zählt' : ''}
          </p>
          <Link to="/einstellungen" className="mt-2 inline-flex items-center gap-1 text-accent-cyan hover:underline">
            <SettingsIcon size={14} /> Einstellungen ändern
          </Link>
        </div>
        {selected && (
          <div className="rounded-xl border border-white/10 bg-space-900/50 p-4 text-sm">
            <p className="text-slate-300">
              <span className="font-mono text-accent-cyan">{selected.active_count}</span> von {selected.vocab_count} Vokabeln aktiv
            </p>
            {selected.active_count < selected.vocab_count && (
              <Button
                variant="secondary"
                className="mt-3"
                busy={unlocking}
                onClick={() => void unlockNext()}
              >
                <ChevronsRight size={16} /> Nächste Seite freischalten
              </Button>
            )}
            {unlockMsg && <p className="mt-2 text-xs text-emerald-300">{unlockMsg}</p>}
          </div>
        )}
        <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4 text-sm">
          <p className="text-slate-300">Gelernte Vokabeln {bookId ? 'dieses Buchs' : 'aller Bücher'} sofort wieder fällig machen.</p>
          <Button variant="secondary" className="mt-3" busy={dueBusy} onClick={() => void makeDue()}>
            {plus.active ? 'Wieder fällig machen' : 'Mit Plus: wieder fällig machen'}
          </Button>
          {dueMsg && <p className="mt-2 text-xs text-emerald-300">{dueMsg}</p>}
        </div>
        <Button className="w-full min-h-[52px]" onClick={() => void start()}>
          <Play size={18} /> {mistakeMode ? 'Fehler-Training starten' : 'Runde starten'}
        </Button>
      </Card>
      <PageRules title="Lernen" info="Richtige Antworten beim Lernen geben Ranglistenpunkte und, in Online-Büchern, Coins (je N richtige Antworten und für neu gelernte Vokabeln). Dazu kommt die Wartezeit, nach der eine Vokabel wieder dran ist." keys={['points_per_answer', 'points_daily_cap', 'points_active_day', 'points_accuracy_bonus', 'points_accuracy_min', 'learn_reward', 'learn_daily_cap', 'learn_coin_every', 'learn_coin_cap', 'learn_gap_l1', 'learn_gap_l2', 'learn_gap_l3', 'learn_gap_l4']} />
      <PlusHint ctx="learn" />
    </div>
  )
}

function bothDirections(both: boolean, n: number): string {
  return both ? ` (${Math.floor(n / 2)} Vokabeln in beiden Richtungen)` : ''
}
