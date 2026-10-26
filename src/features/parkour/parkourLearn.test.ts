import { describe, expect, it } from 'vitest'
import { makePool, nextQuestion } from './parkourLearn'

const v = (i: number) => ({ vocabulary_id: `v${i}`, german: `de${i}`, german_alts: [], translations: [`en${i}`] })

describe('parkourLearn', () => {
  it('leerer Pool gibt keine Frage', () => {
    expect(nextQuestion(makePool([]), new Set())).toBeNull()
    expect(nextQuestion(makePool([{ ...v(1), translations: [] }]), new Set())).toBeNull()
  })
  it('stellt zuerst Vokabeln, die noch nicht dran waren, und wiederholt erst bei leerem Rest', () => {
    const pool = makePool([v(1), v(2), v(3)])
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) { const q = nextQuestion(pool, seen)!; expect(seen.has(q.vocabularyId)).toBe(false); seen.add(q.vocabularyId) }
    expect(nextQuestion(pool, seen)).not.toBeNull()
  })
  it('akzeptiert die richtige Lösung beider Richtungen', () => {
    const pool = makePool([v(7)])
    for (let i = 0; i < 10; i++) {
      const q = nextQuestion(pool, new Set())!
      expect(q.accepted).toEqual(q.direction === 'forward' ? ['en7'] : ['de7'])
    }
  })
})
