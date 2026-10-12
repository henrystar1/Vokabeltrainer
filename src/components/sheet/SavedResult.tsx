import { Printer } from 'lucide-react'
import Button from '../ui/Button'
import { formatDateTime } from '../../lib/format'
import { fromSaved, type SavedGapAnswer } from '../../lib/gaps'
import { GRADE_WORD, gradeFromScore, percentOf } from '../../lib/grade'
import type { StoredResult } from '../../services/ai'
import GapSheet from './GapSheet'

/** Ein gespeichertes Ergebnis (Grammatik oder Test): Note oben, darunter das Blatt mit markierten Fehlern. */
export default function SavedResult({ result }: { result: StoredResult }) {
  const payload = result.payload as { items?: SavedGapAnswer[]; headings?: Record<string, string> }
  const { items, given, grade } = fromSaved(payload.items ?? [])
  const headings = Object.fromEntries(Object.entries(payload.headings ?? {}).map(([k, v]) => [Number(k), v]))
  const note = gradeFromScore(result.score, result.total)
  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div>
          <p className="text-xs text-slate-500">{formatDateTime(result.created_at)}</p>
          <p className="text-lg font-semibold">{result.title}</p>
          <p className="text-sm text-slate-400">{result.score} von {result.total} richtig · {percentOf(result.score, result.total)} %</p>
        </div>
        <div className="text-center">
          <p className="font-mono text-4xl text-accent-cyan">{note}</p>
          <p className="text-xs text-slate-400">{GRADE_WORD[note]}</p>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer size={16} /> Drucken</Button>
      </div>
      <GapSheet items={items} given={given} grade={grade} headings={headings} title={result.title} />
    </div>
  )
}
