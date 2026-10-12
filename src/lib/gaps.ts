import { isAnswerCorrect } from '../features/learning/answer'

/** Lückentext-Aufgabe: `{{1}}`, `{{2}}` … im Text sind die Lücken; `answers[i]` = alle richtigen Antworten der Lücke i+1. */
export interface GapItem {
  text: string
  answers: string[][]
  hints: string[]
  explanation: string
}

export type Segment = { type: 'text'; value: string } | { type: 'gap'; index: number }

export function splitGaps(text: string): Segment[] {
  const out: Segment[] = []
  const re = /\{\{(\d+)\}\}/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'gap', index: Number(m[1]) - 1 })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

export function gapCount(item: GapItem): number {
  return item.answers.length
}

export interface GapGrade {
  /** Pro Lücke richtig? */
  gaps: boolean[]
  /** Anzahl richtiger Lücken. */
  correct: number
  total: number
}

export function gradeGaps(item: GapItem, given: readonly string[], caseSensitive = false): GapGrade {
  const gaps = item.answers.map((acc, i) => isAnswerCorrect(given[i] ?? '', acc, caseSensitive))
  return { gaps, correct: gaps.filter(Boolean).length, total: gaps.length }
}

export interface SheetGrade {
  items: GapGrade[]
  correct: number
  total: number
}

export function gradeSheet(items: readonly GapItem[], given: ReadonlyArray<readonly string[]>, caseSensitive = false): SheetGrade {
  const graded = items.map((it, i) => gradeGaps(it, given[i] ?? [], caseSensitive))
  return { items: graded, correct: graded.reduce((s, g) => s + g.correct, 0), total: graded.reduce((s, g) => s + g.total, 0) }
}

/** Gespeicherte Ergebnisse (payload) – bewusst schlicht, damit alte Einträge lesbar bleiben. */
export interface SavedGapAnswer {
  text: string
  answers: string[][]
  hints: string[]
  explanation: string
  given: string[]
  ok: boolean[]
}

/** Gleiche Regel wie in der KI-Funktion (supabase/functions/ai/lib.ts), damit gespeicherte Blätter gefunden werden. */
export function topicKey(topic: string): string {
  return topic
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

/** Blatt + Eingaben + Bewertung → speicherbare Form. */
export function toSaved(items: readonly GapItem[], given: ReadonlyArray<readonly string[]>, grade: SheetGrade): SavedGapAnswer[] {
  return items.map((it, i) => ({
    text: it.text,
    answers: it.answers,
    hints: it.hints,
    explanation: it.explanation,
    given: it.answers.map((_, k) => given[i]?.[k] ?? ''),
    ok: grade.items[i].gaps,
  }))
}

/** Gespeicherte Antworten wieder als Blatt mit Bewertung darstellen. */
export function fromSaved(saved: readonly SavedGapAnswer[]): { items: GapItem[]; given: string[][]; grade: SheetGrade } {
  const items: GapItem[] = saved.map((s) => ({ text: s.text, answers: s.answers, hints: s.hints ?? [], explanation: s.explanation ?? '' }))
  const gaps = saved.map((s) => s.answers.map((_, k) => !!s.ok?.[k]))
  const graded = gaps.map((g) => ({ gaps: g, correct: g.filter(Boolean).length, total: g.length }))
  return {
    items,
    given: saved.map((s) => s.answers.map((_, k) => s.given?.[k] ?? '')),
    grade: { items: graded, correct: graded.reduce((a, g) => a + g.correct, 0), total: graded.reduce((a, g) => a + g.total, 0) },
  }
}
