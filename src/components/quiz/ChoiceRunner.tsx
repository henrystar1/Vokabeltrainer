import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ProgressBar from '../ui/ProgressBar'
import { useFocusMode } from '../../features/koins/focusMode'

export interface ChoiceQuestion {
  id: string
  prompt: string
  /** Kleine Zeile unter der Frage (z. B. deutsche Bedeutung). */
  sub?: string
  options: string[]
  correct: number
  /** Wird nach der Antwort gezeigt (z. B. „la voiture“). */
  reveal?: string
}

export interface ChoiceAnswer { question: ChoiceQuestion; picked: number; correct: boolean }

interface Props {
  questions: ChoiceQuestion[]
  title: string
  /** grid: bis zu vier Antworten untereinander; leftright: zwei große Tasten links/rechts (auch Pfeiltasten und Wischen). */
  layout?: 'grid' | 'leftright'
  /** Beschriftung der Seiten bei leftright (z. B. „le“ links, „la“ rechts). */
  onFinish: (answers: ChoiceAnswer[]) => void
  onCancel: () => void
}

const AUTO_NEXT_MS = 650

/** Frage mit Auswahl: sofortige Rückmeldung, bei richtiger Antwort geht es von selbst weiter. */
export default function ChoiceRunner({ questions, title, layout = 'grid', onFinish, onCancel }: Props) {
  useFocusMode(true)
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const answers = useRef<ChoiceAnswer[]>([])
  const timer = useRef(0)
  const finished = useRef(false)
  const swipe = useRef<number | null>(null)
  const q = questions[index]

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => {
      window.removeEventListener('beforeunload', guard)
      window.clearTimeout(timer.current)
    }
  }, [])

  const next = useCallback(() => {
    window.clearTimeout(timer.current)
    setPicked(null)
    if (index + 1 >= questions.length) {
      if (!finished.current) {
        finished.current = true
        onFinish(answers.current)
      }
    } else setIndex((i) => i + 1)
  }, [index, questions.length, onFinish])

  const pick = useCallback(
    (i: number) => {
      if (picked !== null || !q) return
      const correct = i === q.correct
      answers.current.push({ question: q, picked: i, correct })
      setPicked(i)
      if (correct) timer.current = window.setTimeout(next, AUTO_NEXT_MS)
    },
    [picked, q, next],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picked !== null) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault()
          next()
        }
        return
      }
      if (layout === 'leftright') {
        if (e.key === 'ArrowLeft') pick(0)
        else if (e.key === 'ArrowRight') pick(1)
        else return
        e.preventDefault()
      } else {
        const n = Number(e.key)
        if (n >= 1 && n <= (q?.options.length ?? 0)) pick(n - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, next, pick, picked, q])

  if (!q) return null
  const state = (i: number) =>
    picked === null ? 'idle' : i === q.correct ? 'right' : i === picked ? 'wrong' : 'dim'
  const cls = {
    idle: 'border-white/15 bg-white/5 hover:bg-white/10 active:bg-white/20',
    right: 'border-emerald-400/70 bg-emerald-400/15 text-emerald-100',
    wrong: 'border-rose-500/70 bg-rose-500/15 text-rose-100',
    dim: 'border-white/5 bg-white/[0.02] text-slate-500',
  } as const

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-mono">{title}</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-slate-400">{index + 1} / {questions.length}</span>
            <button type="button" onClick={() => setConfirmCancel(true)} aria-label="Runde abbrechen" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-slate-100">
              <X size={20} />
            </button>
          </div>
        </div>
        <ProgressBar value={(index / questions.length) * 100} label="Fortschritt der Runde" />
      </div>

      <div
        className="glass touch-pan-y select-none rounded-3xl p-6 shadow-glow sm:p-10"
        onPointerDown={(e) => { swipe.current = e.clientX }}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = null
          if (layout !== 'leftright' || s === null || Math.abs(e.clientX - s) < 60) return
          pick(e.clientX < s ? 0 : 1)
        }}
      >
        <p className="break-words text-center text-3xl font-semibold tracking-tight sm:text-4xl" aria-live="polite">{q.prompt}</p>
        {q.sub && <p className="mt-2 text-center text-sm text-slate-400">{q.sub}</p>}

        {layout === 'grid' ? (
          <div className="mt-8 grid gap-3">
            {q.options.map((o, i) => (
              <button key={`${i}-${o}`} type="button" disabled={picked !== null} onClick={() => pick(i)} className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-4 text-left text-lg transition ${cls[state(i)]}`}>
                <span className="font-mono text-sm text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words">{o}</span>
                {state(i) === 'right' && <Check size={18} />}
                {state(i) === 'wrong' && <X size={18} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4">
            {q.options.map((o, i) => (
              <button key={o} type="button" disabled={picked !== null} onClick={() => pick(i)} className={`flex h-28 flex-col items-center justify-center gap-1 rounded-3xl border text-3xl font-semibold transition active:scale-95 ${cls[state(i)]}`}>
                <span>{o}</span>
                {i === 0 ? <ArrowLeft size={18} className="text-slate-500" /> : <ArrowRight size={18} className="text-slate-500" />}
              </button>
            ))}
          </div>
        )}

        {picked !== null && (
          <div className={`mt-6 rounded-2xl border px-4 py-3 ${picked === q.correct ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-rose-500/30 bg-rose-500/10'}`} role="status">
            <p className={`font-semibold ${picked === q.correct ? 'text-emerald-300' : 'text-rose-300'}`}>{picked === q.correct ? 'Richtig!' : 'Leider falsch'}</p>
            {q.reveal && <p className="mt-1 text-sm text-slate-200">{q.reveal}</p>}
            {picked !== q.correct && (
              <Button className="mt-3 w-full" onClick={next}>{index + 1 >= questions.length ? 'Fertig' : 'Weiter'}</Button>
            )}
          </div>
        )}
      </div>
      {layout === 'leftright' && <p className="mt-3 text-center text-xs text-slate-500">Tippen, nach links/rechts wischen oder ← → drücken</p>}

      {confirmCancel && (
        <Modal title="Runde abbrechen?" onClose={() => setConfirmCancel(false)}>
          <p className="text-sm text-slate-300">Die Antworten dieser Runde werden dann nicht gewertet.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Weitermachen</Button>
            <Button onClick={onCancel}>Abbrechen</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
