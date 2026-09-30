import { describe, expect, it } from 'vitest'
import type { PoolVocab } from '../../types'
import { mulberry32 } from './random'
import { weightedSample } from './selection'
import {
  buildLearningQuestions,
  buildTestQuestions,
  minPairGap,
  vocabCountFor,
} from './questions'

const mk = (i: number, level = 1, tr?: string[]): PoolVocab => ({
  vocabulary_id: `v${i}`,
  book_id: 'b',
  german: `de${i}`,
  translations: tr ?? [`en${i}`],
  level,
})
const pool = (n: number, level = 1) => Array.from({ length: n }, (_, i) => mk(i, level))
const both = ['forward', 'backward'] as const

describe('weightedSample', () => {
  it('wählt nie Elemente mit Gewicht 0 und bevorzugt hohe Gewichte', () => {
    const rng = mulberry32(1)
    const items = [{ id: 'a', w: 0 }, { id: 'b', w: 1 }, { id: 'c', w: 16 }]
    let c = 0, b = 0
    for (let i = 0; i < 500; i++) {
      const [first] = weightedSample(items, (x) => x.w, 1, rng)
      expect(first.id).not.toBe('a')
      if (first.id === 'c') c++
      else b++
    }
    expect(c).toBeGreaterThan(b * 5)
  })
})

describe('vocabCountFor', () => {
  it('halbiert bei zwei Richtungen', () => {
    expect(vocabCountFor(20, both)).toBe(10)
    expect(vocabCountFor(20, ['forward'])).toBe(20)
  })
})

describe('buildLearningQuestions', () => {
  it('liefert bei zwei Richtungen genau die gewünschte (gerade) Anzahl, jede Vokabel zweimal', () => {
    const qs = buildLearningQuestions(pool(50), { directions: both, questionCount: 20, rng: mulberry32(3) })
    expect(qs).toHaveLength(20)
    const per = new Map<string, Set<string>>()
    qs.forEach((q) => per.set(q.vocabularyId, (per.get(q.vocabularyId) ?? new Set()).add(q.direction)))
    expect(per.size).toBe(10)
    for (const d of per.values()) expect(d.size).toBe(2)
  })
  it('hält die beiden Richtungen einer Vokabel auseinander', () => {
    const qs = buildLearningQuestions(pool(50), { directions: both, questionCount: 40, rng: mulberry32(5) })
    expect(minPairGap(qs)).toBeGreaterThanOrEqual(4)
  })
  it('nimmt Stufe-5-Vokabeln nie auf', () => {
    const p = [...pool(10, 1), ...pool(10, 5).map((v, i) => ({ ...v, vocabulary_id: `x${i}` }))]
    const qs = buildLearningQuestions(p, { directions: both, questionCount: 40, rng: mulberry32(9) })
    expect(qs.every((q) => !q.vocabularyId.startsWith('x'))).toBe(true)
    expect(qs).toHaveLength(20)
  })
  it('funktioniert mit einer Richtung', () => {
    const qs = buildLearningQuestions(pool(10), { directions: ['backward'], questionCount: 5, rng: mulberry32(2) })
    expect(qs).toHaveLength(5)
    expect(qs.every((q) => q.direction === 'backward')).toBe(true)
  })
  it('akzeptiert in Rückrichtung alle deutschen Wörter mit derselben Übersetzung', () => {
    const p = [mk(1, 1, ['flat']), mk(2, 1, ['flat'])]
    const qs = buildLearningQuestions(p, { directions: ['backward'], questionCount: 2, rng: mulberry32(1) })
    for (const q of qs) expect(q.accepted.sort()).toEqual(['de1', 'de2'])
  })
  it('zeigt bei mehreren Lösungen alle akzeptierten an', () => {
    const p = [mk(1, 1, ['a', 'b'])]
    const [q] = buildLearningQuestions(p, { directions: ['forward'], questionCount: 1, rng: mulberry32(1) })
    expect(q.accepted).toEqual(['a', 'b'])
  })
})

describe('buildTestQuestions', () => {
  it('fragt erst alle Vorwärts-, dann alle Rückwärtsfragen in Buchreihenfolge', () => {
    const v = pool(3)
    const qs = buildTestQuestions(v, v, { directions: both, rng: mulberry32(1) })
    expect(qs.map((q) => q.id)).toEqual(['v0:forward', 'v1:forward', 'v2:forward', 'v0:backward', 'v1:backward', 'v2:backward'])
  })
})
