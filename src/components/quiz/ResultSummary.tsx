import Card from '../ui/Card'
import ProgressRing from '../charts/ProgressRing'
import type { Question } from '../../features/learning/questions'

export interface WrongAnswer {
  question: Question
  given: string
}

interface ResultSummaryProps {
  total: number
  correct: number
  wrong: WrongAnswer[]
}

export default function ResultSummary({ total, correct, wrong }: ResultSummaryProps) {
  const percent = total === 0 ? 0 : (correct / total) * 100
  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <ProgressRing value={percent} size={128} label="Trefferquote" />
        <div>
          <p className="label-mono">Ergebnis</p>
          <p className="mt-1 text-3xl font-semibold">
            {correct} von {total} richtig
          </p>
          <p className="mt-1 text-sm text-slate-400">{wrong.length === 0 ? 'Fehlerfrei – stark!' : `${wrong.length} Fehler`}</p>
        </div>
      </Card>

      {wrong.length > 0 && (
        <Card>
          <p className="label-mono mb-3">Fehler</p>
          <ul className="divide-y divide-white/5">
            {wrong.map((w) => (
              <li key={w.question.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{w.question.prompt}</span>
                <span className="text-sm">
                  <span className="text-rose-300 line-through decoration-rose-400/60">{w.given.trim() || '(leer)'}</span>
                  <span className="mx-2 text-slate-500">→</span>
                  <span className="text-emerald-300">{w.question.accepted.join(' / ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
