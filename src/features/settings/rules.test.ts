import { describe, expect, it } from 'vitest'
import { activeDirections, normalizeQuestionCount, normalizeSettings } from './rules'

const base = { learn_language: 'en', direction_to_foreign: true, direction_to_german: true, words_per_round: 21, case_sensitive: false }

describe('settings rules', () => {
  it('macht die Anzahl bei zwei Richtungen gerade', () => {
    expect(normalizeQuestionCount(21, true)).toBe(22)
    expect(normalizeQuestionCount(1, true)).toBe(2)
    expect(normalizeQuestionCount(199, true)).toBe(200)
  })
  it('begrenzt auf 1–200', () => {
    expect(normalizeQuestionCount(0, false)).toBe(1)
    expect(normalizeQuestionCount(999, false)).toBe(200)
    expect(normalizeQuestionCount(NaN, false)).toBe(20)
  })
  it('erzwingt mindestens eine Richtung', () => {
    const s = normalizeSettings({ ...base, direction_to_foreign: false, direction_to_german: false })
    expect(s.direction_to_foreign).toBe(true)
    expect(activeDirections(s)).toEqual(['forward'])
  })
  it('lässt ungerade Zahlen bei einer Richtung zu', () => {
    expect(normalizeSettings({ ...base, direction_to_german: false }).words_per_round).toBe(21)
  })
})
