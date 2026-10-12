import type { VocabLike } from '../learning/questions'
import { shuffle, type Rng } from '../learning/random'

export interface SheetPick {
  /** Vokabeln für den Vokabelteil (zufällig). */
  rows: VocabLike[]
  /** Vokabeln für den Satzteil (nach Möglichkeit andere als im Vokabelteil). */
  sentenceVocab: VocabLike[]
  /** So viele Vokabel-Aufgaben soll das Blatt haben. */
  rowCount: number
}

/**
 * Wählt für ein Test-Blatt zufällig aus dem Bereich: insgesamt `total` Aufgaben.
 * Mit Sätzen gehen etwa 40 % (höchstens `maxSentences`) in den Satzteil, der Rest in den Vokabelteil.
 * Bei zwei Abfragerichtungen ergibt eine Vokabel zwei Aufgaben, daher werden entsprechend weniger Vokabeln gezogen.
 */
export function pickSheetVocab(vocab: readonly VocabLike[], total: number, withSentences: boolean, maxSentences: number, directionCount: number, rng: Rng = Math.random): SheetPick {
  const t = Math.max(1, Math.floor(total))
  const withTranslation = vocab.filter((v) => v.translations.length > 0)
  const sCount = withSentences ? Math.min(Math.max(0, Math.floor(maxSentences)), Math.floor(t * 0.4), withTranslation.length) : 0
  const rowCount = Math.max(1, t - sCount)
  const dirs = Math.max(1, directionCount)
  const shuffled = shuffle(vocab, rng)
  const rows = shuffled.slice(0, Math.ceil(rowCount / dirs))
  const used = new Set(rows.map((v) => v.vocabulary_id))
  const rest = shuffled.filter((v) => !used.has(v.vocabulary_id) && v.translations.length > 0)
  const sentenceVocab = rest.slice(0, sCount)
  if (sentenceVocab.length < sCount) {
    const fill = shuffle(withTranslation.filter((v) => !sentenceVocab.includes(v)), rng)
    sentenceVocab.push(...fill.slice(0, sCount - sentenceVocab.length))
  }
  return { rows, sentenceVocab, rowCount }
}
