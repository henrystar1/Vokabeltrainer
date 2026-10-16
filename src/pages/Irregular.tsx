import { useRef, useState } from 'react'
import { ListOrdered, Play } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import type { WrongAnswer } from '../components/quiz/ResultSummary'
import ChoiceResult from '../components/quiz/ChoiceResult'
import type { ChoiceAnswer } from '../components/quiz/ChoiceRunner'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice } from '../components/ui/States'
import { useSettings } from '../features/settings/SettingsProvider'
import {
  EN_FORM_LABEL, EN_VERBS, FR_FORM_LABEL, FR_VERBS, buildEnglishQuestions, buildFrenchQuestions,
  type EnForm, type FrForm,
} from '../features/irregular/irregular'
import type { Question } from '../features/learning/questions'

type Phase = { name: 'setup' } | { name: 'run'; questions: Question[] } | { name: 'result'; answers: ChoiceAnswer[] }
type Lang = 'en' | 'fr'

const EN_FORMS = Object.keys(EN_FORM_LABEL) as EnForm[]
const FR_FORMS = Object.keys(FR_FORM_LABEL) as FrForm[]

/** Unregelmäßige Verben: Englisch (Simple Past / Participle) und Französisch (Präsens, Participe passé, Futur). */
export default function Irregular() {
  const { settings, update } = useSettings()
  const lang: Lang = settings.learn_language === 'fr' ? 'fr' : 'en'
  const [enForms, setEnForms] = useState<EnForm[]>(['past', 'pp'])
  const [frForms, setFrForms] = useState<FrForm[]>(['je', 'pp'])
  const [count, setCount] = useState(20)
  const [showList, setShowList] = useState(false)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const given = useRef<ChoiceAnswer[]>([])
  const wrongRef = useRef<WrongAnswer[]>([])

  const selected = lang === 'en' ? enForms.length : frForms.length

  function start() {
    given.current = []
    wrongRef.current = []
    setPhase({ name: 'run', questions: lang === 'en' ? buildEnglishQuestions(enForms, count) : buildFrenchQuestions(frForms, count) })
  }

  if (phase.name === 'run') {
    return (
      <QuizRunner
        questions={phase.questions}
        caseSensitive={false}
        accents={lang === 'fr' ? 'fr' : false}
        title="Irreguläre Verben"
        labelFor={(q) => {
          const f = q.id.split('|')[2]
          return lang === 'en' ? EN_FORM_LABEL[f as EnForm] : FR_FORM_LABEL[f as FrForm]
        }}
        onAnswer={(q, g, ok) => {
          given.current.push({ question: { id: q.id, prompt: `${q.prompt} · ${q.accepted[0] ? (lang === 'en' ? EN_FORM_LABEL[q.id.split('|')[2] as EnForm] : FR_FORM_LABEL[q.id.split('|')[2] as FrForm]) : ''}`, options: [g || '(leer)', q.accepted.join(' / ')], correct: 1 }, picked: ok ? 1 : 0, correct: ok })
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
        {wrong.length > 0 && <p className="text-xs text-slate-500">Tipp: Schau dir die Liste an (Seite „Irreguläre Verben“ → Liste) und sprich die Formen laut.</p>}
      </div>
    )
  }

  const toggle = <T extends string>(list: T[], set: (v: T[]) => void, k: T, on: boolean) => set(on ? [...list, k] : list.filter((x) => x !== k))

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={lang === 'en' ? 'Englisch' : 'Französisch'} title="Irreguläre Verben" />
      <Card className="space-y-5">
        <Field label="Sprache">
          <Select value={lang} onChange={(e) => void update({ learn_language: e.target.value })}>
            <option value="en">Englisch ({EN_VERBS.length} Verben)</option>
            <option value="fr">Französisch ({FR_VERBS.length} Verben)</option>
          </Select>
        </Field>
        <p className="text-sm text-slate-300">
          {lang === 'en'
            ? 'Du siehst den Infinitiv und tippst die gefragte Form. Wo es zwei Varianten gibt (learnt/learned), zählt jede.'
            : 'Du siehst den Infinitiv und tippst die gefragte Form. Bei „je“ geht es mit und ohne Pronomen.'}
        </p>
        <fieldset>
          <legend className="label-mono mb-2">Was soll abgefragt werden?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {lang === 'en'
              ? EN_FORMS.map((f) => (
                  <label key={f} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={enForms.includes(f)} onChange={(e) => toggle(enForms, setEnForms, f, e.target.checked)} />
                    {EN_FORM_LABEL[f]}
                  </label>
                ))
              : FR_FORMS.map((f) => (
                  <label key={f} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={frForms.includes(f)} onChange={(e) => toggle(frForms, setFrForms, f, e.target.checked)} />
                    {FR_FORM_LABEL[f]}
                  </label>
                ))}
          </div>
        </fieldset>
        <Field label="Anzahl Fragen">
          <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[10, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        {selected === 0 && <ErrorBox message="Wähle mindestens eine Form." />}
        <Button onClick={start} disabled={selected === 0} className="w-full"><Play size={16} /> Starten</Button>
        <Button variant="ghost" onClick={() => setShowList((s) => !s)} className="w-full"><ListOrdered size={16} /> {showList ? 'Liste ausblenden' : 'Liste ansehen'}</Button>
        {showList && (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-slate-400">
                {lang === 'en'
                  ? <tr><th className="p-2">Infinitiv</th><th className="p-2">Simple Past</th><th className="p-2">Participle</th><th className="p-2">Deutsch</th></tr>
                  : <tr><th className="p-2">Infinitiv</th><th className="p-2">je</th><th className="p-2">nous</th><th className="p-2">Participe</th><th className="p-2">Deutsch</th></tr>}
              </thead>
              <tbody>
                {lang === 'en'
                  ? EN_VERBS.map((v) => <tr key={v.inf} className="border-t border-white/5"><td className="p-2 font-medium">{v.inf}</td><td className="p-2">{v.past}</td><td className="p-2">{v.pp}</td><td className="p-2 text-slate-400">{v.de}</td></tr>)
                  : FR_VERBS.map((v) => <tr key={v.inf} className="border-t border-white/5"><td className="p-2 font-medium">{v.inf}</td><td className="p-2">{v.pres[0]}</td><td className="p-2">{v.pres[3]}</td><td className="p-2">{v.pp}</td><td className="p-2 text-slate-400">{v.de}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {lang === 'fr' && <Notice tone="info">Weitere Zeiten (Imparfait, Passé composé) übst du unter „Konjugieren“.</Notice>}
    </div>
  )
}
