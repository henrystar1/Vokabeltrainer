import { describe, expect, it } from 'vitest'
import { gradeGaps, gradeSheet, splitGaps, type GapItem } from './gaps'

const item: GapItem = { text: 'She {{1}} home and {{2}} tea.', answers: [['went'], ["didn't drink", 'did not drink']], hints: ['go', ''], explanation: '' }

describe('splitGaps', () => {
  it('teilt Text und Lücken', () => {
    expect(splitGaps(item.text)).toEqual([
      { type: 'text', value: 'She ' }, { type: 'gap', index: 0 },
      { type: 'text', value: ' home and ' }, { type: 'gap', index: 1 }, { type: 'text', value: ' tea.' },
    ])
  })
  it('Text ohne Lücke bleibt Text', () => expect(splitGaps('Hallo')).toEqual([{ type: 'text', value: 'Hallo' }]))
})

describe('gradeGaps', () => {
  it('prüft jede Lücke einzeln, ohne auf Groß-/Kleinschreibung zu achten', () => {
    const g = gradeGaps(item, ['Went', "didn’t drink"])
    expect(g.gaps).toEqual([true, true])
    expect(g.correct).toBe(2)
  })
  it('leer und falsch zählt falsch', () => {
    expect(gradeGaps(item, ['', 'drank']).gaps).toEqual([false, false])
    expect(gradeGaps(item, []).correct).toBe(0)
  })
  it('Tippfehler bleiben falsch', () => expect(gradeGaps(item, ['wnet', 'did not drink']).gaps).toEqual([false, true]))
})

describe('gradeSheet', () => {
  it('summiert über alle Aufgaben', () => {
    const s = gradeSheet([item, item], [['went', 'did not drink'], ['x', 'y']])
    expect(s.correct).toBe(2)
    expect(s.total).toBe(4)
  })
})

import { fromSaved, toSaved, topicKey } from './gaps'

describe('Speichern', () => {
  it('Themenschlüssel wie auf dem Server', () => {
    expect(topicKey('Participe passé')).toBe('participe_passe')
    expect(topicKey('Past Perfect')).toBe('past_perfect')
  })
  it('hin und zurück', () => {
    const grade = gradeSheet([item], [['went', 'x']])
    const saved = toSaved([item], [['went', 'x']], grade)
    const back = fromSaved(saved)
    expect(back.grade.correct).toBe(1)
    expect(back.grade.total).toBe(2)
    expect(back.given).toEqual([['went', 'x']])
    expect(back.items[0].answers).toEqual(item.answers)
  })
})
