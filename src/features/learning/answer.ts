/**
 * Antwortvergleich. Erlaubt sind nur Schreibweisen, die keine Tippfehler sind:
 *  - Groß-/Kleinschreibung (abschaltbar über "Groß-/Kleinschreibung beachten")
 *  - überzählige Leerzeichen
 *  - typografische Anführungszeichen/Apostrophe (iPad setzt ’ statt ')
 *  - Unicode-Normalform (é als ein Zeichen oder e + Akzent)
 * Tippfehler bleiben falsch, es gibt keine Fehlerkorrektur.
 */
export function normalizeAnswer(text: string, caseSensitive: boolean): string {
  const t = text
    .normalize('NFC')
    .replace(/[‘’‛′ʼ]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return caseSensitive ? t : t.toLowerCase()
}

export function isAnswerCorrect(given: string, accepted: readonly string[], caseSensitive: boolean): boolean {
  const g = normalizeAnswer(given, caseSensitive)
  if (g === '') return false
  return accepted.some((a) => normalizeAnswer(a, caseSensitive) === g)
}
