import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import AccentBar from '../ui/AccentBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useFocusMode } from '../../features/koins/focusMode'
import ProgressBar from '../ui/ProgressBar'
import { isAnswerCorrect } from '../../features/learning/answer'
import type { Question } from '../../features/learning/questions'

interface QuizRunnerProps {
  questions: Question[]
  caseSensitive: boolean
  /** Bei jedem beantworteten Item. */
  onAnswer: (q: Question, given: string, correct: boolean) => void
  onFinish: () => void
  /** Nach falscher Antwort sofort Lösungen zeigen (Standard); im Test ohne Feedback später. */
  showFeedback?: boolean
  title?: string
  /** Leiste mit französischen Sonderzeichen einblenden. */
  accents?: boolean
  /** Wird nach Bestätigung des "X" aufgerufen. Die laufende Runde wird dann verworfen. */
  onCancel?: () => void
}

const DIRECTION_LABEL = { forward: 'Deutsch → Fremdsprache', backward: 'Fremdsprache → Deutsch' } as const

/** Abfrageoberfläche: eine Frage nach der anderen, getippte Antwort, sofortige Rückmeldung. */
export default function QuizRunner({ questions, caseSensitive, onAnswer, onFinish, showFeedback = true, title, accents = false, onCancel }: QuizRunnerProps) {
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ correct: boolean } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = questions[index]

  // Fokusmodus: Seitenleiste/Navigation sind weg, Abbrechen nur über das X.
  useFocusMode(true)

  // Schutz vor versehentlichem Neuladen/Schließen des Tabs mitten in der Runde.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [index])

  if (!q) return null

  function advance() {
    setResult(null)
    setValue('')
    if (index + 1 >= questions.length) onFinish()
    else setIndex(index + 1)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (result) {
      advance()
      return
    }
    const correct = isAnswerCorrect(value, q.accepted, caseSensitive)
    onAnswer(q, value, correct)
    if (showFeedback) setResult({ correct })
    else advance()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-mono">{title ?? 'Abfrage'}</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-slate-400">
              {index + 1} / {questions.length}
            </span>
            {onCancel && (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                aria-label="Runde abbrechen"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>
        <ProgressBar value={(index / questions.length) * 100} label="Fortschritt der Runde" />
      </div>

      <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-glow sm:p-10">
        <p className="label-mono">{DIRECTION_LABEL[q.direction]}</p>
        <p className="mt-4 break-words text-center text-3xl font-semibold tracking-tight sm:text-4xl" aria-live="polite">
          {q.prompt}
        </p>

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={result !== null}
          aria-label="Deine Antwort"
          placeholder="Antwort eingeben …"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          className={`mt-8 min-h-[56px] w-full rounded-2xl border bg-space-900/70 px-4 text-center text-xl outline-none transition ${
            result === null
              ? 'border-white/10 focus:border-accent-cyan/60 focus:ring-2 focus:ring-accent-cyan/20'
              : result.correct
                ? 'border-emerald-400/60 text-emerald-200'
                : 'border-rose-500/60 text-rose-200'
          }`}
        />

        {result && (
          <div className={`mt-5 rounded-2xl border px-4 py-3 ${result.correct ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-rose-500/30 bg-rose-500/10'}`} role="status">
            <p className={`flex items-center gap-2 font-semibold ${result.correct ? 'text-emerald-300' : 'text-rose-300'}`}>
              {result.correct ? <Check size={18} /> : <X size={18} />}
              {result.correct ? 'Richtig!' : 'Leider falsch'}
            </p>
            {!result.correct && (
              <p className="mt-1 text-sm text-slate-200">
                Richtig wäre: <span className="font-semibold">{q.accepted.join(' / ')}</span>
              </p>
            )}
            {result.correct && q.accepted.length > 1 && (
              <p className="mt-1 text-sm text-slate-300">Weitere Lösungen: {q.accepted.filter((a) => a.toLowerCase() !== value.trim().toLowerCase()).join(' / ')}</p>
            )}
          </div>
        )}

        {accents && q.direction === 'forward' && result === null && <AccentBar className="mt-4" />}

        <Button type="submit" className="mt-6 w-full min-h-[52px]">
          {result ? (index + 1 >= questions.length ? 'Fertig' : 'Weiter') : 'Prüfen'} <ArrowRight size={18} />
        </Button>
      </form>

      {confirmCancel && onCancel && (
        <Modal title="Runde abbrechen?" onClose={() => setConfirmCancel(false)}>
          <p className="text-sm text-slate-300">
            Die Antworten dieser Runde werden dann nicht gewertet und es gibt keine Koins dafür. Du kannst jederzeit eine neue Runde starten.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Weiterlernen</Button>
            <Button onClick={onCancel}>Abbrechen</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
