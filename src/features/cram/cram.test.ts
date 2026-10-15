import { describe, expect, it } from 'vitest'
import { answerAbfrage, answerTest, afterAbfrage, newSession, requeue, startAbfrage, startKarten, startTest, testResult, TEST_SIZE } from './cram'
import { mulberry32 } from '../learning/random'

const vocab = Array.from({ length: 12 }, (_, i) => ({ vocabulary_id: `v${i}`, german: `de${i}`, german_alts: [], translations: [`en${i}`] }))
const rng = () => mulberry32(1)

describe('cram', () => {
  it('requeue hängt hinten an, aber nicht doppelt', () => {
    expect(requeue(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(requeue(['a', 'b', 'a'], 'a')).toEqual(['b', 'a'])
  })
  it('Abfrage: falsch kommt wieder und ist schwer, richtig verschwindet', () => {
    let s = startAbfrage(newSession('t', 'b', vocab), rng())
    const first = s.quiz[0]
    const n = s.quiz.length
    const r = answerAbfrage(s, '???')
    expect(r.ok).toBe(false)
    expect(r.s.quiz).toHaveLength(n)
    expect(r.s.hard).toContain(first.id)
    s = r.s
    const q = s.quiz[0]
    const right = answerAbfrage(s, startKarten(s).vocab.length ? answerFor(s) : '')
    expect(right.ok).toBe(true)
    expect(right.s.quiz).toHaveLength(n - 1)
    expect(q).toBeTruthy()
  })
  it('nach der Abfrage: schwere Wörter → Karten, sonst Test', () => {
    const s = newSession('t', 'b', vocab)
    expect(afterAbfrage(s, rng()).phase).toBe('test')
    const h = afterAbfrage({ ...s, hard: ['v1'] }, rng())
    expect(h.phase).toBe('karten')
    expect(h.queue).toEqual(['v1'])
  })
  it('Test hat höchstens 10 Wörter und endet mit Ergebnis', () => {
    let s = startTest(newSession('t', 'b', vocab), rng())
    expect(s.test).toHaveLength(TEST_SIZE)
    for (let i = 0; i < TEST_SIZE; i++) s = answerTest(s, 'x')
    expect(s.phase).toBe('ergebnis')
    expect(testResult(s).correct).toBe(0)
  })
  it('kleine Bereiche: Test kürzer', () => {
    expect(startTest(newSession('t', 'b', vocab.slice(0, 3))).test).toHaveLength(3)
  })
})

function answerFor(s: ReturnType<typeof newSession>): string {
  const cur = s.quiz[0]
  const v = s.vocab.find((x) => x.vocabulary_id === cur.id)!
  return cur.dir === 'forward' ? v.translations[0] : v.german
}
