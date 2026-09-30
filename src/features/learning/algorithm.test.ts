import { describe, expect, it } from 'vitest'
import { evaluatePair, nextLevel, MIN_LEVEL, MAX_LEVEL, displayLevel } from './algorithm'

describe('nextLevel – Regeln aus Abschnitt 39', () => {
  const cases: Array<[number, 'both' | 'one' | 'none', number]> = [
    [1, 'both', 2],
    [1, 'one', 1.5],
    [1, 'none', 1],
    [2, 'both', 3],
    [2, 'one', 2.5],
    [2, 'none', 1],
    [4, 'both', 5],
    [4.5, 'both', 5],
    [5, 'both', 5],
    [5, 'none', 4],
  ]

  it.each(cases)('Stufe %s + %s → %s', (level, result, expected) => {
    expect(nextLevel(level, result)).toBe(expected)
  })

  it('weitere Beispiele aus Abschnitt 17', () => {
    expect(nextLevel(2.5, 'both')).toBe(3.5)
    expect(nextLevel(3, 'none')).toBe(2)
  })

  it('fällt niemals unter Stufe 1', () => {
    for (let l = 1; l <= 5; l += 0.5) {
      expect(nextLevel(l, 'none')).toBeGreaterThanOrEqual(MIN_LEVEL)
    }
  })

  it('steigt niemals über Stufe 5', () => {
    for (let l = 1; l <= 5; l += 0.5) {
      expect(nextLevel(l, 'both')).toBeLessThanOrEqual(MAX_LEVEL)
    }
  })
})

describe('evaluatePair', () => {
  it('ordnet beide Richtungen korrekt zu', () => {
    expect(evaluatePair(true, true)).toBe('both')
    expect(evaluatePair(true, false)).toBe('one')
    expect(evaluatePair(false, true)).toBe('one')
    expect(evaluatePair(false, false)).toBe('none')
  })
})

describe('displayLevel', () => {
  it('zeigt in der UI nur ganze Stufen 1–5', () => {
    expect(displayLevel(1)).toBe(1)
    expect(displayLevel(1.5)).toBe(1)
    expect(displayLevel(2.5)).toBe(2)
    expect(displayLevel(4.5)).toBe(4)
    expect(displayLevel(5)).toBe(5)
  })
})
