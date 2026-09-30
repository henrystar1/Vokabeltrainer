import type { Rng } from './random'

/**
 * Gewichtete Auswahl ohne Zurücklegen (Efraimidis–Spirakis):
 * Elemente mit höherem Gewicht werden wahrscheinlicher gewählt, jedes Element mit
 * Gewicht > 0 behält aber eine Chance. Elemente mit Gewicht ≤ 0 werden nie gewählt.
 */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rng: Rng = Math.random,
): T[] {
  const keyed: Array<{ item: T; key: number }> = []
  for (const item of items) {
    const w = weightOf(item)
    if (!(w > 0)) continue
    keyed.push({ item, key: Math.pow(rng(), 1 / w) })
  }
  keyed.sort((a, b) => b.key - a.key)
  return keyed.slice(0, Math.max(0, count)).map((k) => k.item)
}
