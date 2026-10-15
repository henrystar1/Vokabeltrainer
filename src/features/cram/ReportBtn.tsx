import { Flag } from 'lucide-react'
import Button from '../../components/ui/Button'
import type { VocabLike } from '../learning/questions'

export interface Rep { report: (v: VocabLike) => void; sent: ReadonlySet<string> }

/** Vokabel melden, ohne sie sich merken zu müssen. */
export function ReportBtn({ v, rep }: { v: VocabLike | undefined; rep: Rep }) {
  if (!v) return null
  const done = rep.sent.has(v.vocabulary_id)
  return (
    <Button variant="ghost" disabled={done} onClick={() => rep.report(v)}>
      <Flag size={16} /> {done ? 'Gemeldet' : 'Melden'}
    </Button>
  )
}
