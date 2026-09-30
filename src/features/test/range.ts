import type { BookEntry } from '../../types'
import type { VocabLike } from '../learning/questions'

export type RangeMode = 'vocab' | 'page' | 'unit'

export interface RangeSpec {
  mode: RangeMode
  /** vocab: Buchreihenfolge-Nummer (BookEntry.order), page: Seitenzahl, unit: Unit-Nummer */
  from: number
  to: number
}

/** Einträge im gewählten Bereich (Grenzen einschließlich), in Buchreihenfolge. */
export function selectRange(entries: readonly BookEntry[], spec: RangeSpec): BookEntry[] {
  const lo = Math.min(spec.from, spec.to)
  const hi = Math.max(spec.from, spec.to)
  const value = (e: BookEntry) =>
    spec.mode === 'vocab' ? e.order : spec.mode === 'page' ? e.page_number : e.unit_number
  return entries.filter((e) => value(e) >= lo && value(e) <= hi).sort((a, b) => a.order - b.order)
}

/** Jede Vokabel einmal, in der Reihenfolge ihres ersten Vorkommens. */
export function distinctVocabulary(entries: readonly BookEntry[]): VocabLike[] {
  const seen = new Set<string>()
  const out: VocabLike[] = []
  for (const e of entries) {
    if (seen.has(e.vocabulary_id)) continue
    seen.add(e.vocabulary_id)
    out.push({ vocabulary_id: e.vocabulary_id, german: e.german, german_alts: e.german_alts ?? [], translations: e.translations })
  }
  return out
}
