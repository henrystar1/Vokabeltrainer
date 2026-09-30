import { describe, expect, it } from 'vitest'
import { isAnswerCorrect, normalizeAnswer } from './answer'

describe('answer', () => {
  it('ignoriert Groß-/Kleinschreibung nur wenn erlaubt', () => {
    expect(isAnswerCorrect('House', ['house'], false)).toBe(true)
    expect(isAnswerCorrect('House', ['house'], true)).toBe(false)
  })
  it('ignoriert überzählige Leerzeichen und typografische Apostrophe', () => {
    expect(isAnswerCorrect('  it’s   fine ', ["it's fine"], false)).toBe(true)
  })
  it('akzeptiert jede der Lösungen, aber keine Tippfehler', () => {
    expect(isAnswerCorrect('flat', ['apartment', 'flat'], false)).toBe(true)
    expect(isAnswerCorrect('aprtment', ['apartment'], false)).toBe(false)
  })
  it('leere Antwort ist falsch', () => {
    expect(isAnswerCorrect('  ', [''], false)).toBe(false)
  })
  it('vereinheitlicht Unicode', () => {
    expect(normalizeAnswer('é', true)).toBe('é')
  })
})
