import type { Direction, UserSettings } from '../../types'

export const MIN_QUESTIONS = 1
export const MAX_QUESTIONS = 200

export function activeDirections(s: Pick<UserSettings, 'direction_to_foreign' | 'direction_to_german'>): Direction[] {
  // Fremdsprache → Deutsch steht immer zuerst.
  const d: Direction[] = []
  if (s.direction_to_german) d.push('backward')
  if (s.direction_to_foreign) d.push('forward')
  return d.length > 0 ? d : ['forward']
}

/** Bei zwei Richtungen wird jede Vokabel zweimal abgefragt – die Anzahl ist dann gerade (mindestens 2). */
export function normalizeQuestionCount(n: number, bothDirections: boolean): number {
  let v = Number.isFinite(n) ? Math.round(n) : 20
  v = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, v))
  if (bothDirections) {
    if (v % 2 === 1) v = v + 1 <= MAX_QUESTIONS ? v + 1 : v - 1
    v = Math.max(2, v)
  }
  return v
}

/** Gespeicherte Standardwerte einer Sprache über die Einstellungen legen (nur wenn für die Sprache etwas gemerkt ist). */
export function withLanguageDefaults(s: UserSettings, language: string): UserSettings {
  const d = s.language_defaults?.[language]
  return d ? { ...s, learn_language: language, words_per_round: d.words_per_round, direction_to_foreign: d.direction_to_foreign, direction_to_german: d.direction_to_german } : { ...s, learn_language: language }
}

/** Aktuelle Anzahl und Richtung als Standard der aktuellen Sprache merken. */
export function rememberLanguageDefaults(s: UserSettings): UserSettings {
  return {
    ...s,
    language_defaults: {
      ...s.language_defaults,
      [s.learn_language]: { words_per_round: s.words_per_round, direction_to_foreign: s.direction_to_foreign, direction_to_german: s.direction_to_german },
    },
  }
}

export function normalizeSettings(s: UserSettings): UserSettings {
  const both = s.direction_to_foreign && s.direction_to_german
  const neither = !s.direction_to_foreign && !s.direction_to_german
  return {
    ...s,
    direction_to_foreign: neither ? true : s.direction_to_foreign,
    words_per_round: normalizeQuestionCount(s.words_per_round, both || neither),
  }
}
