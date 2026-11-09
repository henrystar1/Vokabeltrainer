import { describe, expect, it } from 'vitest'
import { activeDirections, normalizeQuestionCount, normalizeSettings } from './rules'

const base = { learn_language: 'en', direction_to_foreign: true, direction_to_german: true, words_per_round: 21, case_sensitive: false, repeat_until_correct: false, notify_mentions: true, notify_chat: false, notify_print: true, notify_online: 'off' as const, notify_dm: 'window' as const }

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

import { rememberLanguageDefaults, withLanguageDefaults } from './rules'
import type { UserSettings } from '../../types'

describe('Standard pro Sprache', () => {
  const s: UserSettings = { learn_language: 'en', direction_to_foreign: true, direction_to_german: true, words_per_round: 30, case_sensitive: false, repeat_until_correct: false, notify_mentions: true, notify_chat: false, notify_print: true, notify_online: 'off', notify_dm: 'window' }
  it('merkt Anzahl und Richtung je Sprache und stellt sie wieder ein', () => {
    const en = rememberLanguageDefaults(s)
    const fr = rememberLanguageDefaults({ ...withLanguageDefaults(en, 'fr'), words_per_round: 10, direction_to_foreign: false })
    expect(fr.language_defaults?.en?.words_per_round).toBe(30)
    const back = withLanguageDefaults(fr, 'en')
    expect(back.words_per_round).toBe(30)
    expect(back.direction_to_foreign).toBe(true)
    expect(withLanguageDefaults(fr, 'fr').words_per_round).toBe(10)
  })
  it('lässt unbekannte Sprachen unverändert', () => {
    expect(withLanguageDefaults(s, 'es').words_per_round).toBe(30)
  })
})
