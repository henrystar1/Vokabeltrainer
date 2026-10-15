import { useMemo, useState } from 'react'
import { accentsFor } from '../ui/AccentBar'
import { Check, Printer } from 'lucide-react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { ErrorBox, Notice } from '../ui/States'
import GapSheet from './GapSheet'
import type { Question } from '../../features/learning/questions'
import { errorMessage } from '../../lib/errors'
import { gradeSheet, toSaved, type GapItem, type SheetGrade } from '../../lib/gaps'
import { GRADE_WORD, gradeFromScore, percentOf } from '../../lib/grade'
import { saveResult } from '../../services/ai'

interface TestSheetProps {
  title: string
  language: string
  level: string
  questions: readonly Question[]
  /** Sätze zu Vokabeln (nur mit Plus), schon als Lückenaufgaben. */
  sentences: readonly GapItem[]
  notice?: string | null
  caseSensitive: boolean
  onExit: () => void
}

/** Test als Blatt: erst nur Vokabeln, mit Plus zusätzlich Sätze. Am Ende gibt es eine Note; das Ergebnis wird gespeichert. */
export default function TestSheet({ title, language, level, questions, sentences, notice, caseSensitive, onExit }: TestSheetProps) {
  const items = useMemo<GapItem[]>(() => [
    ...questions.map((q) => ({ text: `${q.prompt}  →  {{1}}`, answers: [q.accepted], hints: [''], explanation: '' })),
    ...sentences,
  ], [questions, sentences])
  const headings = useMemo<Record<number, string>>(() => {
    const h: Record<number, string> = { 0: 'Vokabeln' }
    if (sentences.length > 0) h[questions.length] = 'Sätze'
    return h
  }, [questions.length, sentences.length])
  const [given, setGiven] = useState<string[][]>(() => items.map((it) => it.answers.map(() => '')))
  const [result, setResult] = useState<SheetGrade | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const filled = given.reduce((s, g) => s + g.filter((x) => x.trim() !== '').length, 0)
  const total = items.reduce((s, it) => s + it.answers.length, 0)

  async function submit() {
    const g = gradeSheet(items, given, caseSensitive)
    setResult(g)
    try {
      await saveResult({
        kind: 'test', title, ref: null, language, level, score: g.correct, total: g.total,
        payload: { items: toSaved(items, given, g), headings },
      })
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  const note = result ? gradeFromScore(result.correct, result.total) : null
  return (
    <div className="space-y-4">
      {result && note !== null && (
        <Card className="no-print flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="label-mono">Note</p>
            <p className="text-2xl font-semibold">{result.correct} von {result.total} richtig · {percentOf(result.correct, result.total)} %</p>
            <p className="text-sm text-slate-400">Fehler sind rot markiert, die Lösung steht darunter. Das Blatt findest du später unter „Meine Tests“.</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-5xl text-accent-cyan">{note}</p>
            <p className="text-xs text-slate-400">{GRADE_WORD[note]}</p>
          </div>
        </Card>
      )}
      {notice && <Notice tone="warn">{notice}</Notice>}
      {saveError && <ErrorBox message={`Der Test konnte nicht gespeichert werden: ${saveError}`} />}
      <GapSheet
        items={items}
        given={given}
        grade={result}
        headings={headings}
        accents={accentsFor(language)}
        title={title}
        subtitle="Schreibe in jedes Feld die Lösung. Am Ende bekommst du eine Note."
        onChange={(i, k, v) => setGiven((g) => g.map((row, ri) => (ri === i ? row.map((x, ci) => (ci === k ? v : x)) : row)))}
      />
      <div className="no-print flex flex-wrap gap-3">
        {!result && <Button onClick={() => void submit()} disabled={filled === 0}><Check size={18} /> Abgeben ({filled}/{total})</Button>}
        <Button variant={result ? 'primary' : 'ghost'} onClick={onExit}>{result ? 'Fertig' : 'Abbrechen'}</Button>
        <Button variant="ghost" onClick={() => window.print()}><Printer size={16} /> Drucken</Button>
      </div>
    </div>
  )
}
