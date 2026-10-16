import { describe, expect, it } from 'vitest'
import { isAnswerCorrect } from '../learning/answer'
import { EN_VERBS, FR_VERBS, buildEnglishQuestions, buildFrenchQuestions } from './irregular'

describe('unregelmäßige Verben', () => {
  it('englische Fragen akzeptieren Varianten', () => {
    const qs = buildEnglishQuestions(['past', 'pp'], EN_VERBS.length * 2)
    expect(qs.length).toBe(EN_VERBS.length * 2)
    const learn = qs.find((q) => q.id === 'en|learn|past')!
    expect(isAnswerCorrect('learned', learn.accepted, false)).toBe(true)
    expect(isAnswerCorrect('learnt', learn.accepted, false)).toBe(true)
    const be = qs.find((q) => q.id === 'en|be|past')!
    expect(isAnswerCorrect('were', be.accepted, false)).toBe(true)
    expect(isAnswerCorrect('was', be.accepted, false)).toBe(true)
  })
  it('französische Fragen', () => {
    const qs = buildFrenchQuestions(['je', 'nous', 'ils', 'pp', 'futur'], 500)
    const get = (id: string) => qs.find((q) => q.id === id)!
    expect(isAnswerCorrect('vais', get('fr|aller|je').accepted, false)).toBe(true)
    expect(isAnswerCorrect('allons', get('fr|aller|nous').accepted, false)).toBe(true)
    expect(isAnswerCorrect('ont', get('fr|avoir|ils').accepted, false)).toBe(true)
    expect(isAnswerCorrect('vu', get('fr|voir|pp').accepted, false)).toBe(true)
    expect(isAnswerCorrect("j'irai", get('fr|aller|futur').accepted, false)).toBe(true)
    expect(FR_VERBS.length).toBe(22)
  })
})
