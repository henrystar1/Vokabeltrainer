import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import Button from '../ui/Button'
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
}

const DIRECTION_LABEL = { forward: 'Deutsch → Fremdsprache', backward: 'Fremdsprache → Deutsch' } as const

/** Abfrageoberfläche: eine Frage nach der anderen, getippte Antwort, sofortige Rückmeldung. */
export default function QuizRunner({ questions, caseSensitive, onAnswer, onFinish, showFeedback = true, title }: QuizRunnerProps) {
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ correct: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = questions[index]

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
          <span className="font-mono text-sm text-slate-400">
            {index + 1} / {questions.length}
          </span>
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

        <Button type="submit" className="mt-6 w-full min-h-[52px]">
          {result ? (index + 1 >= questions.length ? 'Fertig' : 'Weiter') : 'Prüfen'} <ArrowRight size={18} />
        </Button>
      </form>
    </div>
  )
}
