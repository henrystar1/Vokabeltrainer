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

import { grade, levenshtein, loadCards, mastered, matchesName, normalizeName, pickSession, saveCards, MASTERED_BOX, type Cards } from './flagLearn'

describe('Flaggen-Lernsystem', () => {
  const find = (code: string) => COUNTRIES.find((x) => x.code === code)!
  it('Namen: Umlaute, Groß/Klein, Tippfehler, Alternativen', () => {
    expect(normalizeName('Türkei')).toBe('tuerkei')
    expect(matchesName('tuerkei', find('tr'))).toBe(true)
    expect(matchesName('TÜRKEI', find('tr'))).toBe(true)
    expect(matchesName('Frankreich', find('fr'))).toBe(true)
    expect(matchesName('Frankreic', find('fr'))).toBe(true)
    expect(matchesName('Spanin', find('es'))).toBe(true)
    expect(matchesName('Italien', find('es'))).toBe(false)
    expect(matchesName('usa', find('us'))).toBe(true)
    expect(matchesName('Holland', find('nl'))).toBe(true)
    expect(matchesName('Oman', find('om'))).toBe(true)
    expect(matchesName('Iran', find('iq'))).toBe(false) // zu kurz für Toleranz
    expect(matchesName('', find('de'))).toBe(false)
    expect(levenshtein('abc', 'abd')).toBe(1)
  })
  it('Fächer: richtig +1, falsch −2, Fälligkeit', () => {
    const t = 1_000_000
    expect(grade(undefined, true, t)).toEqual({ box: 1, due: t + 10 * 60_000 })
    expect(grade({ box: 3, due: 0 }, false, t)).toEqual({ box: 1, due: t })
    expect(grade({ box: 5, due: 0 }, true, t).box).toBe(5)
    expect(grade({ box: 0, due: 0 }, false, t).box).toBe(0)
  })
  it('Runde: fällige zuerst, höchstens vier neue', () => {
    const now = 10_000_000
    const cards: Cards = { de: { box: 1, due: now - 5 }, fr: { box: 0, due: now - 9 }, it: { box: 3, due: now + 1000 } }
    const s = pickSession(COUNTRIES, cards, now, 10, 4, () => 0.3)
    expect(s.slice(0, 2).map((c) => c.code)).toEqual(['fr', 'de'])
    expect(s.map((c) => c.code)).not.toContain('it')
    expect(s.filter((c) => !cards[c.code])).toHaveLength(4)
    expect(new Set(s.map((c) => c.code)).size).toBe(s.length)
  })
  it('gemeisterte zählen ab Fach 4; Speichern und Laden', () => {
    const cards: Cards = { de: { box: MASTERED_BOX, due: 0 }, fr: { box: MASTERED_BOX - 1, due: 0 } }
    expect(mastered(cards)).toBe(1)
    const store: Record<string, string> = {}
    ;(globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } } }
    saveCards(cards)
    expect(loadCards()).toEqual(cards)
    delete (globalThis as { window?: unknown }).window
  })
})
