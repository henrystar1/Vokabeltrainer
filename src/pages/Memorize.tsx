import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Eye, Lightbulb, RotateCcw, X } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { COUNTRIES, REGIONS, flagUrl, makeQuestions, poolFor, type FlagQuestion, type Region } from '../features/memorize/flags'
import { PI_DIGITS, checkDigit, groupDigits } from '../features/memorize/pi'
import { POW_LEVELS, makeProblems, parseNumber, problemText, solutionText, type PowLevel, type PowProblem } from '../features/memorize/potenzen'

type Tab = 'pi' | 'pow' | 'flags'
const TABS: Array<[Tab, string]> = [['pi', 'Pi'], ['pow', 'Hochzahlen'], ['flags', 'Flaggen']]

function loadNum(key: string): number {
  try { return Number(window.localStorage.getItem(key) ?? 0) || 0 } catch { return 0 }
}
function saveBest(key: string, v: number): boolean {
  const old = loadNum(key)
  if (v <= old) return false
  try { window.localStorage.setItem(key, String(v)) } catch { /* egal */ }
  return true
}

/** Auswendig lernen: Pi, Hochzahlen (Potenzen) und Flaggen. Bestwerte merkt sich der Browser. */
export default function Memorize() {
  const [tab, setTab] = useState<Tab>('pi')
  return (
    <div>
      <PageHeader eyebrow="Lernen" title="Auswendig" />
      <div role="tablist" className="glass mb-5 inline-flex rounded-xl p-1">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[44px] rounded-lg px-5 text-sm font-medium ${tab === k ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}>{l}</button>
        ))}
      </div>
      {tab === 'pi' && <PiTrainer />}
      {tab === 'pow' && <PowTrainer />}
      {tab === 'flags' && <FlagTrainer />}
    </div>
  )
}

// ---------------------------------------------------------------- Pi

function PiTrainer() {
  const [phase, setPhase] = useState<'learn' | 'quiz' | 'done'>('learn')
  const [shown, setShown] = useState(50)
  const [typed, setTyped] = useState('')
  const [hints, setHints] = useState(0)
  const [wrong, setWrong] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const best = loadNum('pi-best')
  const typedRef = useRef('')
  typedRef.current = typed

  const press = useCallback((d: string) => {
    if (phase !== 'quiz') return
    const res = checkDigit(typedRef.current, d)
    if (res.ok) {
      const next = typedRef.current + d
      setTyped(next)
      if (next.length >= PI_DIGITS.length) { setFresh(saveBest('pi-best', next.length)); setPhase('done') }
    } else {
      setWrong(res.expected)
      setFresh(saveBest('pi-best', typedRef.current.length))
      setPhase('done')
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'quiz') return
    const on = (e: KeyboardEvent) => { if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); press(e.key) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [phase, press])

  function startQuiz() { setTyped(''); setHints(0); setWrong(null); setFresh(false); setPhase('quiz') }
  function hint() {
    const d = PI_DIGITS[typed.length]
    if (!d) return
    setHints((h) => h + 1)
    setTyped((t) => t + d)
  }

  const block = (s: string) => groupDigits(s, 5).join(' ')

  if (phase === 'learn') {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-slate-400">Lies die Stellen in Fünferblöcken, sprich sie laut und deck sie dann ab. Bestwert: <b className="text-accent-cyan">{best}</b> Stellen.</p>
        <Field label="Wie viele Stellen lernen?">
          <Select value={shown} onChange={(e) => setShown(Number(e.target.value))}>
            {[10, 20, 30, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} Stellen</option>)}
          </Select>
        </Field>
        <p className="break-words font-mono text-xl leading-9 text-slate-100" aria-label="Pi">3,<span className="text-accent-cyan">{block(PI_DIGITS.slice(0, shown))}</span></p>
        <Button onClick={startQuiz}><Eye size={18} /> Abfragen</Button>
      </Card>
    )
  }

  const total = PI_DIGITS.length
  return (
    <Card className="space-y-4">
      <p className="font-mono text-xl leading-9">3,<span className="break-words text-slate-100">{block(typed)}</span>{phase === 'quiz' && <span className="ml-1 animate-pulse text-accent-cyan">▌</span>}{phase === 'done' && wrong && <span className="ml-1 text-rose-300">{wrong}?</span>}</p>
      <ProgressBar value={(typed.length / Math.min(total, Math.max(shown, 10))) * 100} label="Fortschritt" />
      <p className="text-sm text-slate-400">{typed.length} Stellen{hints > 0 ? ` (davon ${hints} Tipp${hints > 1 ? 's' : ''})` : ''} · Bestwert {Math.max(best, phase === 'done' ? typed.length - hints : 0)}</p>
      {phase === 'quiz' ? (
        <>
          <div className="grid max-w-xs grid-cols-5 gap-2" role="group" aria-label="Ziffern">
            {'1234567890'.split('').map((d) => (
              <button key={d} type="button" onClick={() => press(d)} className="min-h-[52px] rounded-xl border border-white/15 bg-white/5 font-mono text-xl hover:bg-white/10 active:scale-95">{d}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={hint}><Lightbulb size={16} /> Tipp</Button>
            <Button variant="ghost" onClick={() => setPhase('learn')}>Zurück zum Lernen</Button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-lg font-semibold">{wrong ? `Fehler bei Stelle ${typed.length + 1}: richtig wäre ${wrong}.` : 'Alle 500 Stellen geschafft!'}</p>
          <p className="text-sm text-slate-300">Du kannst {Math.max(0, typed.length - hints)} Stellen ohne Tipp.{fresh && <b className="ml-1 text-emerald-300">Neuer Bestwert!</b>}</p>
          <div className="flex gap-2"><Button onClick={startQuiz}><RotateCcw size={16} /> Nochmal</Button><Button variant="secondary" onClick={() => setPhase('learn')}>Lernen</Button></div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Hochzahlen

interface PowAnswer { p: PowProblem; given: number | null; ok: boolean }

function PowTrainer() {
  const [level, setLevel] = useState<PowLevel>(1)
  const [count, setCount] = useState(10)
  const [list, setList] = useState<PowProblem[] | null>(null)
  const [i, setI] = useState(0)
  const [input, setInput] = useState('')
  const [results, setResults] = useState<PowAnswer[]>([])
  const [fb, setFb] = useState<PowAnswer | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [fresh, setFresh] = useState(false)
  const finished = list !== null && i >= list.length
  const rightCount = results.filter((r) => r.ok).length
  useEffect(() => { if (finished) setFresh(saveBest(`pow-best-${level}-${count}`, rightCount)) }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps

  function start() { setFresh(false); setList(makeProblems(level, count)); setI(0); setInput(''); setResults([]); setFb(null); setInvalid(false) }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!list) return
    if (fb) { setFb(null); setInput(''); setI((x) => x + 1); return }
    const given = parseNumber(input)
    if (given === null) { setInvalid(true); return }
    setInvalid(false)
    const a = { p: list[i], given, ok: given === list[i].answer }
    setResults((r) => [...r, a])
    setFb(a)
  }

  if (!list) {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-slate-400">Quadrate, Kuben und Zweierpotenzen blitzschnell im Kopf. Je höher die Stufe, desto mehr Aufgaben.</p>
        <Field label="Stufe" hint={POW_LEVELS.find((l) => l.level === level)?.hint}>
          <Select value={level} onChange={(e) => setLevel(Number(e.target.value) as PowLevel)}>
            {POW_LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level} – {l.name}</option>)}
          </Select>
        </Field>
        <Field label="Aufgaben"><Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Button onClick={start}>Los</Button>
      </Card>
    )
  }

  if (i >= list.length) {
    const right = results.filter((r) => r.ok).length
    return (
      <Card className="space-y-3">
        <p className="text-2xl font-semibold">{right} von {list.length} richtig{fresh && <span className="ml-2 text-base text-emerald-300">Neuer Bestwert!</span>}</p>
        {results.filter((r) => !r.ok).length > 0 && (
          <ul className="space-y-1 text-sm text-slate-300">
            {results.filter((r) => !r.ok).map((r, k) => <li key={k}><span className="font-mono">{solutionText(r.p)}</span></li>)}
          </ul>
        )}
        <div className="flex gap-2"><Button onClick={start}><RotateCcw size={16} /> Nochmal</Button><Button variant="secondary" onClick={() => setList(null)}>Einstellungen</Button></div>
      </Card>
    )
  }

  const p = list[i]
  return (
    <Card className="space-y-4">
      <ProgressBar value={(i / list.length) * 100} label="Fortschritt" />
      <p className="text-sm text-slate-400">Aufgabe {i + 1} von {list.length}</p>
      <p className="font-mono text-4xl" aria-live="polite">{problemText(p)}</p>
      <form onSubmit={submit} className="space-y-3">
        <TextInput autoFocus inputMode="numeric" value={input} onChange={(e) => { setInput(e.target.value); setInvalid(false) }} disabled={fb !== null} placeholder={p.kind === 'exp' ? 'Hochzahl' : 'Ergebnis'} aria-label="Antwort" />
        {invalid && <p className="text-sm text-amber-300">Bitte eine Zahl eingeben.</p>}
        {fb && (
          <p className={`flex items-center gap-2 text-sm ${fb.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {fb.ok ? <Check size={16} /> : <X size={16} />} {fb.ok ? 'Richtig!' : `Falsch. Richtig ist ${fb.p.answer}.`} <span className="font-mono text-slate-400">({solutionText(fb.p)})</span>
          </p>
        )}
        <Button type="submit">{fb ? 'Weiter' : 'Prüfen'}</Button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------- Flaggen

function FlagTrainer() {
  const [regions, setRegions] = useState<Region[]>(['europa'])
  const [mode, setMode] = useState<'name' | 'flag'>('name')
  const [count, setCount] = useState(10)
  const [qs, setQs] = useState<FlagQuestion[] | null>(null)
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [wrongs, setWrongs] = useState<FlagQuestion[]>([])
  const [score, setScore] = useState(0)
  const pool = useMemo(() => poolFor(regions), [regions])

  function toggle(r: Region) { setRegions((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r])) }
  function start() { setQs(makeQuestions(pool, count, mode)); setI(0); setPicked(null); setWrongs([]); setScore(0) }
  function pick(code: string) {
    if (!qs || picked) return
    setPicked(code)
    if (code === qs[i].country.code) setScore((s) => s + 1)
    else setWrongs((w) => [...w, qs[i]])
  }

  if (!qs) {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-slate-400">{COUNTRIES.length} Länder. Wähle, welche Weltgegenden du üben willst (nichts gewählt = alle).</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Weltgegenden">
          {REGIONS.map((r) => (
            <button key={r.id} type="button" aria-pressed={regions.includes(r.id)} onClick={() => toggle(r.id)} className={`min-h-[44px] rounded-xl border px-4 text-sm ${regions.includes(r.id) ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan' : 'border-white/15 text-slate-300 hover:bg-white/5'}`}>{r.name}</button>
          ))}
        </div>
        <Field label="Aufgabenart">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'name' | 'flag')}>
            <option value="name">Flagge sehen, Land wählen</option>
            <option value="flag">Land lesen, Flagge wählen</option>
          </Select>
        </Field>
        <Field label="Fragen" hint={`Es stehen ${pool.length} Länder zur Auswahl.`}><Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Button onClick={start}>Los</Button>
      </Card>
    )
  }

  if (i >= qs.length) {
    return (
      <Card className="space-y-3">
        <p className="text-2xl font-semibold">{score} von {qs.length} richtig</p>
        {wrongs.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Das solltest du nochmal ansehen:</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {wrongs.map((q) => (
                <li key={q.country.code} className="flex items-center gap-3 rounded-xl border border-white/10 p-2">
                  <img src={flagUrl(q.country.code, 160)} alt="" className="h-10 w-16 rounded object-cover" />
                  <span className="text-sm">{q.country.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2"><Button onClick={start}><RotateCcw size={16} /> Nochmal</Button><Button variant="secondary" onClick={() => setQs(null)}>Einstellungen</Button></div>
      </Card>
    )
  }

  const q = qs[i]
  return (
    <Card className="space-y-4">
      <ProgressBar value={(i / qs.length) * 100} label="Fortschritt" />
      <p className="text-sm text-slate-400">Frage {i + 1} von {qs.length}</p>
      {q.mode === 'name' ? (
        <>
          <img src={flagUrl(q.country.code)} alt="Flagge" className="mx-auto h-40 max-w-full rounded-lg border border-white/10 object-contain" />
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => <Choice key={o.code} state={choiceState(picked, o.code, q.country.code)} onClick={() => pick(o.code)}>{o.name}</Choice>)}
          </div>
        </>
      ) : (
        <>
          <p className="text-center text-2xl font-semibold">{q.country.name}</p>
          <div className="grid grid-cols-2 gap-2">
            {q.options.map((o) => (
              <Choice key={o.code} state={choiceState(picked, o.code, q.country.code)} onClick={() => pick(o.code)}>
                <img src={flagUrl(o.code, 160)} alt={picked ? o.name : 'Flagge'} className="mx-auto h-20 max-w-full object-contain" />
              </Choice>
            ))}
          </div>
        </>
      )}
      {picked && (
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm ${picked === q.country.code ? 'text-emerald-300' : 'text-rose-300'}`}>{picked === q.country.code ? 'Richtig!' : `Falsch – das war ${q.country.name}.`}</p>
          <Button onClick={() => { setPicked(null); setI((x) => x + 1) }}>Weiter</Button>
        </div>
      )}
    </Card>
  )
}

type ChoiceState = 'idle' | 'right' | 'wrong' | 'dim'
const choiceState = (picked: string | null, code: string, answer: string): ChoiceState =>
  !picked ? 'idle' : code === answer ? 'right' : code === picked ? 'wrong' : 'dim'

function Choice({ state, onClick, children }: { state: ChoiceState; onClick: () => void; children: ReactNode }) {
  const tone = { idle: 'border-white/15 bg-white/5 hover:bg-white/10', right: 'border-emerald-400/60 bg-emerald-500/15', wrong: 'border-rose-400/60 bg-rose-500/15', dim: 'border-white/10 opacity-50' }[state]
  return <button type="button" onClick={onClick} disabled={state !== 'idle'} className={`min-h-[52px] rounded-xl border p-2 text-base transition active:scale-[0.98] ${tone}`}>{children}</button>
}
