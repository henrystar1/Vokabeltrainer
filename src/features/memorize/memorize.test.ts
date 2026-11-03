import { describe, expect, it } from 'vitest'
import { PI_DIGITS, checkDigit, groupDigits } from './pi'
import { makeProblem, makeProblems, pairsFor, parseNumber, problemText, superscript } from './potenzen'
import { COUNTRIES, makeQuestions, poolFor } from './flags'

describe('Pi', () => {
  it('beginnt richtig und hat 500 Stellen', () => {
    expect(PI_DIGITS.slice(0, 20)).toBe('14159265358979323846')
    expect(PI_DIGITS).toHaveLength(500)
    expect(PI_DIGITS).toMatch(/^\d+$/)
  })
  it('gruppiert in Fünferblöcke', () => {
    expect(groupDigits('1415926', 5)).toEqual(['14159', '26'])
  })
  it('prüft Ziffern', () => {
    expect(checkDigit('', '1')).toEqual({ ok: true, correct: 1, expected: '1' })
    expect(checkDigit('14', '2')).toMatchObject({ ok: false, correct: 2, expected: '1' })
    expect(checkDigit(PI_DIGITS, '1').ok).toBe(false)
  })
})

describe('Potenzen', () => {
  it('rechnet richtig', () => {
    for (const lv of [1, 2, 3, 4] as const) {
      for (const [b, e] of pairsFor(lv)) expect(b ** e).toBeLessThan(2 ** 31)
      for (let i = 0; i < 100; i++) {
        const p = makeProblem(lv)
        expect(p.base ** (p.kind === 'exp' ? p.answer : p.exp!)).toBe(p.value)
        expect(p.kind === 'exp' ? p.answer : p.answer).toBeGreaterThan(0)
      }
    }
  })
  it('Aufgabenstufen steigen', () => {
    expect(pairsFor(1).length).toBeLessThan(pairsFor(2).length)
    expect(pairsFor(2).length).toBeLessThan(pairsFor(3).length)
  })
  it('Texte und Eingabe', () => {
    expect(superscript(16)).toBe('¹⁶')
    expect(problemText({ base: 7, exp: 2, answer: 49, value: 49, kind: 'value' })).toBe('7² = ?')
    expect(problemText({ base: 2, exp: null, answer: 10, value: 1024, kind: 'exp' })).toBe('2? = 1024')
    expect(parseNumber(' 1.024 ')).toBe(1024)
    expect(parseNumber('abc')).toBeNull()
  })
  it('ohne Dopplungen in einer Runde', () => {
    const l = makeProblems(1, 10)
    expect(new Set(l.map((p) => p.value)).size).toBe(10)
  })
})

describe('Flaggen', () => {
  it('Codes und Namen sind eindeutig', () => {
    expect(new Set(COUNTRIES.map((x) => x.code)).size).toBe(COUNTRIES.length)
    expect(new Set(COUNTRIES.map((x) => x.name)).size).toBe(COUNTRIES.length)
    expect(COUNTRIES.every((x) => /^[a-z]{2}$/.test(x.code))).toBe(true)
  })
  it('Fragen haben vier verschiedene Antworten mit der richtigen', () => {
    for (const regions of [[], ['ozeanien'], ['europa', 'afrika']] as const) {
      for (const q of makeQuestions(poolFor(regions), 10, 'name')) {
        expect(q.options).toHaveLength(4)
        expect(new Set(q.options.map((o) => o.code)).size).toBe(4)
        expect(q.options.some((o) => o.code === q.country.code)).toBe(true)
      }
    }
  })
})
