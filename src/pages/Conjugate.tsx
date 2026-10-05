import { useRef, useState } from 'react'
import { Languages, Play } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import type { WrongAnswer } from '../components/quiz/ResultSummary'
import ChoiceResult from '../components/quiz/ChoiceResult'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox } from '../components/ui/States'
import { PRONOUNS, TENSE_LABEL, VERBS, accepted, type Tense } from '../features/french/verbs'
import { shuffle } from '../features/learning/random'
import type { Question } from '../features/learning/questions'
import type { ChoiceAnswer } from '../components/quiz/ChoiceRunner'

type Phase = { name: 'setup' } | { name: 'run'; questions: Question[] } | { name: 'result'; answers: ChoiceAnswer[] }

const TENSES = Object.keys(TENSE_LABEL) as Tense[]

function buildConjugationQuestions(tenses: Tense[], count: number): Question[] {
  const all = VERBS.flatMap((v) => tenses.flatMap((t) => PRONOUNS.map((_, i) => ({ v, t, i }))))
  return shuffle(all).slice(0, count).map(({ v, t, i }) => ({
    id: `${v.inf}|${t}|${i}`,
    vocabularyId: v.inf,
    direction: 'forward' as const,
    prompt: `${v.inf} · ${PRONOUNS[i]}`,
    accepted: accepted(v, t, i),
  }))
}

/** Französische Verben konjugieren. Ergebnis zählt wie Multiple Choice (weniger Coins/Punkte, kein Lernstand). */
export default function Conjugate() {
  const [tenses, setTenses] = useState<Tense[]>(['present'])
  const [count, setCount] = useState(15)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const given = useRef<ChoiceAnswer[]>([])
  const wrongRef = useRef<WrongAnswer[]>([])

  function start() {
    given.current = []
    wrongRef.current = []
    setPhase({ name: 'run', questions: buildConjugationQuestions(tenses, count) })
  }

  if (phase.name === 'run') {
    return (
      <QuizRunner
        questions={phase.questions}
        caseSensitive={false}
        accents
        title="Konjugieren"
        labelFor={(q) => `${TENSE_LABEL[q.id.split('|')[1] as Tense]} – ${VERBS.find((v) => v.inf === q.vocabularyId)?.de ?? ''}`}
        onAnswer={(q, g, ok) => {
          given.current.push({ question: { id: q.id, prompt: q.prompt, options: [g || '(leer)', q.accepted[0]], correct: 1 }, picked: ok ? 1 : 0, correct: ok })
          if (!ok) wrongRef.current.push({ question: q, given: g })
        }}
        onFinish={() => {
          setWrong([...wrongRef.current])
          setPhase({ name: 'result', answers: [...given.current] })
        }}
        onCancel={() => setPhase({ name: 'setup' })}
      />
    )
  }

  if (phase.name === 'result') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <ChoiceResult answers={phase.answers} onAgain={start} />
        {wrong.length > 0 && <p className="text-xs text-slate-500">Tipp: Lies die Fehler oben noch einmal laut, dann merkst du sie dir besser.</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Französisch" title="Konjugieren" />
      <Card className="space-y-5">
        <p className="flex items-start gap-3 text-sm text-slate-300"><Languages className="mt-0.5 shrink-0 text-accent-cyan" size={18} /> Du siehst ein Verb und eine Person und tippst die passende Form. Mit oder ohne Pronomen ist beides richtig (je oder j’ vor Vokal).</p>
        <fieldset>
          <legend className="label-mono mb-2">Zeiten</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TENSES.map((t) => (
              <label key={t} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm">
                <input
                  type="checkbox"
                  checked={tenses.includes(t)}
                  onChange={(e) => setTenses((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
                  className="h-5 w-5 accent-cyan-400"
                />
                {TENSE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Anzahl Fragen">
          <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        {tenses.length === 0 && <ErrorBox message="Wähle mindestens eine Zeit." />}
        <Button onClick={start} disabled={tenses.length === 0} className="w-full"><Play size={16} /> Starten</Button>
      </Card>
      <p className="mt-3 text-xs text-slate-500">{VERBS.length} Verben, darunter die wichtigsten unregelmäßigen. Mit „être“ im Passé composé zählen männliche und weibliche Formen.</p>
    </div>
  )
}
