import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Play, RotateCcw, X } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { Notice } from '../components/ui/States'
import { LEVELS, OPS, generateProblems, parseAnswer, type Level, type Op, type Problem } from '../features/math/problems'

const KEY = 'mathe-auswahl'
interface Choice { ops: Op[]; level: Level; count: number }
const DEFAULT: Choice = { ops: ['+', '-'], level: 2, count: 10 }

function load(): Choice {
  try {
    const c = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Choice | null
    if (c && Array.isArray(c.ops) && c.ops.length > 0 && c.level >= 1 && c.level <= 5 && [10, 20, 30].includes(c.count)) return c
  } catch { /* egal */ }
  return DEFAULT
}

interface Answered { p: Problem; given: number | null; ok: boolean }

/** Kopfrechnen mit + − × ÷, frei wählbar nach Rechenart und Schwierigkeit. Nur zum Üben, es gibt keine Coins. */
export default function MathPage() {
  const [choice, setChoice] = useState<Choice>(load)
  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup')
  const [list, setList] = useState<Problem[]>([])
  const [i, setI] = useState(0)
  const [input, setInput] = useState('')
  const [results, setResults] = useState<Answered[]>([])
  const [feedback, setFeedback] = useState<Answered | null>(null)
  const [invalid, setInvalid] = useState(false)
  const startedAt = useRef(0)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(choice)) } catch { /* egal */ }
  }, [choice])

  function toggle(op: Op) {
    setChoice((c) => {
      const has = c.ops.includes(op)
      if (has && c.ops.length === 1) return c
      return { ...c, ops: OPS.map((o) => o.op).filter((o) => (o === op ? !has : c.ops.includes(o))) }
    })
  }

  function start() {
    setList(generateProblems(choice.ops, choice.level, choice.count))
    setI(0)
    setInput('')
    setResults([])
    setFeedback(null)
    setInvalid(false)
    startedAt.current = Date.now()
    setPhase('run')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (feedback) { next(); return }
    const given = parseAnswer(input)
    if (given === null) { setInvalid(true); return }
    setInvalid(false)
    const a: Answered = { p: list[i], given, ok: given === list[i].answer }
    setResults((r) => [...r, a])
    setFeedback(a)
  }

  function next() {
    setFeedback(null)
    setInput('')
    if (i + 1 >= list.length) {
      setSeconds(Math.round((Date.now() - startedAt.current) / 1000))
      setPhase('done')
    } else setI(i + 1)
  }

  const correct = results.filter((r) => r.ok).length
  const wrong = useMemo(() => results.filter((r) => !r.ok), [results])
  const levelInfo = LEVELS.find((l) => l.level === choice.level)!

  if (phase === 'run') {
    const p = list[i]
    return (
      <div>
        <PageHeader eyebrow="Kopfrechnen" title="Mathe" />
        <Card className="mx-auto max-w-md space-y-5">
          <div>
            <div className="mb-1 flex justify-between font-mono text-xs text-slate-400"><span>Aufgabe {i + 1} von {list.length}</span><span>{correct} richtig</span></div>
            <ProgressBar value={(i / list.length) * 100} label="Fortschritt" />
          </div>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-center font-mono text-4xl text-accent-cyan" aria-live="polite">{p.text} = ?</p>
            <TextInput
              key={i}
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              aria-label="Deine Antwort"
              className="text-center text-2xl"
              value={input}
              readOnly={!!feedback}
              onChange={(e) => { setInput(e.target.value); setInvalid(false) }}
            />
            {invalid && <p className="text-center text-sm text-amber-300">Bitte eine ganze Zahl eingeben.</p>}
            {feedback && (
              <div className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm ${feedback.ok ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/40 bg-rose-400/10 text-rose-200'}`} role="status">
                {feedback.ok ? <><Check size={16} /> Richtig!</> : <><X size={16} /> Falsch. Richtig ist {feedback.p.answer.toLocaleString('de-DE')}.</>}
              </div>
            )}
            <Button type="submit" className="w-full min-h-[48px]">{feedback ? (i + 1 >= list.length ? 'Ergebnis ansehen' : 'Weiter') : 'Prüfen'}</Button>
          </form>
          <button type="button" className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setPhase('setup')}>Abbrechen</button>
        </Card>
      </div>
    )
  }

  if (phase === 'done') {
    const pct = Math.round((correct / Math.max(results.length, 1)) * 100)
    return (
      <div>
        <PageHeader eyebrow="Kopfrechnen" title="Ergebnis" />
        <Card className="mx-auto max-w-md space-y-4">
          <p className="text-center font-mono text-4xl text-accent-cyan">{correct} / {results.length}</p>
          <p className="text-center text-sm text-slate-400">{pct} % richtig · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} min · ⌀ {(seconds / Math.max(results.length, 1)).toFixed(1).replace('.', ',')} s pro Aufgabe</p>
          {wrong.length > 0 ? (
            <div>
              <p className="label-mono mb-2">Das war falsch</p>
              <ul className="space-y-1 text-sm">
                {wrong.map((w, k) => (
                  <li key={k} className="flex justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 font-mono">
                    <span>{w.p.text}</span>
                    <span><span className="text-rose-300 line-through">{w.given}</span> <span className="text-emerald-300">{w.p.answer.toLocaleString('de-DE')}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Notice tone="ok">Alles richtig!</Notice>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={start}><RotateCcw size={16} /> Nochmal</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setPhase('setup')}>Auswahl ändern</Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Kopfrechnen" title="Mathe" />
      <Card className="mx-auto max-w-xl space-y-5">
        <div>
          <p className="label-mono mb-2">Rechenarten</p>
          <div className="grid grid-cols-4 gap-2">
            {OPS.map((o) => {
              const on = choice.ops.includes(o.op)
              return (
                <button
                  key={o.op}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.op)}
                  className={`flex min-h-[64px] flex-col items-center justify-center rounded-xl border text-sm transition ${on ? 'border-accent-cyan/60 bg-accent-cyan/15 text-accent-cyan' : 'border-white/10 text-slate-400 hover:text-white'}`}
                >
                  <span className="font-mono text-2xl leading-none">{o.sign}</span>
                  <span className="mt-1 text-xs">{o.name}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">Mindestens eine Rechenart muss an sein.</p>
        </div>
        <Field label="Schwierigkeit">
          <Select value={choice.level} onChange={(e) => setChoice({ ...choice, level: Number(e.target.value) as Level })}>
            {LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level} – {l.name}</option>)}
          </Select>
        </Field>
        <ul className="space-y-1 rounded-xl border border-white/10 bg-space-900/50 p-3 text-xs text-slate-400">
          {OPS.filter((o) => choice.ops.includes(o.op)).map((o) => (
            <li key={o.op}><span className="font-mono text-accent-cyan">{o.sign}</span> {o.name}: {levelInfo.hint[o.op]}</li>
          ))}
        </ul>
        <Field label="Anzahl Aufgaben">
          <Select value={choice.count} onChange={(e) => setChoice({ ...choice, count: Number(e.target.value) })}>
            {[10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Button className="w-full min-h-[52px]" onClick={start}><Play size={18} /> Starten</Button>
      </Card>
    </div>
  )
}
