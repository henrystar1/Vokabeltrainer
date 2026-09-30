/** Lernalgorithmus: reine, testbare Logik ohne Abhängigkeit von UI oder Datenbank. */

export const MIN_LEVEL = 1
export const MAX_LEVEL = 5
export const LEVEL_STEP = 0.5

export type PairResult = 'both' | 'one' | 'none'

/** Beide Richtungen einer Vokabel zu einem Ergebnis zusammenfassen. */
export function evaluatePair(forwardCorrect: boolean, backwardCorrect: boolean): PairResult {
  const correct = Number(forwardCorrect) + Number(backwardCorrect)
  return correct === 2 ? 'both' : correct === 1 ? 'one' : 'none'
}

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level))
}

const DELTA: Record<PairResult, number> = { both: 1, one: 0.5, none: -1 }

/** Neuer Lernstand: beide richtig +1, eine richtig +0,5, beide falsch −1; immer in [1, 5]. */
export function nextLevel(current: number, result: PairResult): number {
  return clampLevel(current + DELTA[result])
}

/** In der Oberfläche werden nur ganze Stufen 1–5 angezeigt. */
export function displayLevel(level: number): number {
  return Math.floor(clampLevel(level))
}

/** Stufe 5 gilt als aktuell nicht fällig. */
export function isDue(level: number): boolean {
  return level < MAX_LEVEL
}

/**
 * Auswahlgewicht: niedrige Stufe = hohes Gewicht (Stufe 1 stark bevorzugt).
 * Nicht fällige Vokabeln (Stufe 5) haben Gewicht 0. Jede fällige Vokabel behält
 * ein positives Mindestgewicht, damit nicht immer dieselben Vokabeln drankommen.
 */
export function selectionWeight(level: number): number {
  if (!isDue(level)) return 0
  const l = clampLevel(level)
  return Math.pow(2, MAX_LEVEL - l) // Stufe 1 → 16, 2 → 8, 3 → 4, 4 → 2, 4.5 → ~1.41
}
