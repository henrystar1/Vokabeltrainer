import { describe, expect, it } from 'vitest'
import type { VocabLike } from '../learning/questions'
import { pickSheetVocab } from './sheetPick'

const mk = (n: number): VocabLike[] => Array.from({ length: n }, (_, i) => ({ vocabulary_id: `v${i}`, german: `de${i}`, german_alts: [], translations: [`en${i}`] }))

describe('pickSheetVocab', () => {
  it('zieht nur die gewünschte Anzahl, nicht alle', () => {
    const p = pickSheetVocab(mk(100), 20, false, 20, 1)
    expect(p.rows).toHaveLength(20)
    expect(p.sentenceVocab).toHaveLength(0)
  })
  it('bei zwei Richtungen werden halb so viele Vokabeln gezogen', () => expect(pickSheetVocab(mk(100), 20, false, 20, 2).rows).toHaveLength(10))
  it('mit Sätzen werden Vokabel- und Satzteil getrennt gezogen', () => {
    const p = pickSheetVocab(mk(100), 20, true, 20, 1)
    expect(p.sentenceVocab).toHaveLength(8)
    expect(p.rowCount).toBe(12)
    expect(p.rows).toHaveLength(12)
    const ids = new Set(p.rows.map((v) => v.vocabulary_id))
    expect(p.sentenceVocab.every((v) => !ids.has(v.vocabulary_id))).toBe(true)
  })
  it('Satzgrenze aus den Einstellungen gilt', () => expect(pickSheetVocab(mk(100), 50, true, 5, 1).sentenceVocab).toHaveLength(5))
  it('weniger Vokabeln als gewünscht: nimmt alle', () => expect(pickSheetVocab(mk(6), 20, false, 20, 1).rows).toHaveLength(6))
  it('Reihenfolge ist zufällig', () => {
    const a = pickSheetVocab(mk(50), 10, false, 20, 1, () => 0.1).rows.map((v) => v.vocabulary_id).join()
    const b = pickSheetVocab(mk(50), 10, false, 20, 1, () => 0.9).rows.map((v) => v.vocabulary_id).join()
    expect(a).not.toBe(b)
  })
})
