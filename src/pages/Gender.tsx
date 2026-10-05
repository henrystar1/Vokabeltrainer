import { useState } from 'react'
import { ArrowLeftRight, Play } from 'lucide-react'
import ChoiceResult from '../components/quiz/ChoiceResult'
import ChoiceRunner, { type ChoiceAnswer, type ChoiceQuestion } from '../components/quiz/ChoiceRunner'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { Notice } from '../components/ui/States'
import { buildGenderQuestions, extractGenderWords } from '../features/french/gender'
import { useAsync } from '../lib/useAsync'
import { getLearningPool } from '../services/learning'
import { ErrorBox, Spinner } from '../components/ui/States'

type Phase = { name: 'setup' } | { name: 'run'; questions: ChoiceQuestion[] } | { name: 'result'; answers: ChoiceAnswer[] }

/** le oder la? Links = le (männlich), rechts = la (weiblich). */
export default function Gender() {
  const [count, setCount] = useState(20)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const pool = useAsync(() => getLearningPool('fr', null), [])
  const words = pool.data ? extractGenderWords(pool.data) : []
  const start = () => setPhase({ name: 'run', questions: buildGenderQuestions(words, count) })

  if (phase.name === 'run') return <ChoiceRunner layout="leftright" title="le oder la?" questions={phase.questions} onFinish={(answers) => setPhase({ name: 'result', answers })} onCancel={() => setPhase({ name: 'setup' })} />
  if (phase.name === 'result') return <ChoiceResult answers={phase.answers} onAgain={start} />

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Französisch" title="le oder la?" />
      <Card className="space-y-5">
        <p className="flex items-start gap-3 text-sm text-slate-300"><ArrowLeftRight className="mt-0.5 shrink-0 text-accent-cyan" size={18} /> Du siehst ein französisches Wort. Ist es männlich (<b>le</b>, linke Taste) oder weiblich (<b>la</b>, rechte Taste)? Du kannst auch nach links oder rechts wischen.</p>
        <Field label="Anzahl Wörter">
          <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[10, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        {pool.loading ? <Spinner /> : pool.error ? <ErrorBox message={pool.error} /> : words.length < 5 ? (
          <Notice tone="info">Dafür brauchst du mindestens 5 aktive Französisch-Vokabeln mit le/la (z. B. „la maison“). Aktiviere in deinen Büchern mehr Vokabeln.</Notice>
        ) : (
          <Notice tone="info">Es kommen {words.length} Wörter aus deinen Französisch-Büchern vor. Wörter mit l’ (z. B. l’eau) sind nicht dabei.</Notice>
        )}
        <Button onClick={start} disabled={words.length < 5} className="w-full"><Play size={16} /> Starten</Button>
      </Card>
    </div>
  )
}
