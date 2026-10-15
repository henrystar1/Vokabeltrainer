import type { Rng } from '../learning/random'

export const MOLE_HOLES = 9
export const MOLE_SECONDS = 40

/** Wie lange ein Maulwurf oben bleibt (ms): wird mit der Zeit kürzer. */
export const moleUpTime = (elapsedSec: number): number => Math.max(480, Math.round(1100 - elapsedSec * 15))

/** Pause bis zum nächsten Maulwurf (ms). */
export const moleGap = (elapsedSec: number): number => Math.max(180, Math.round(520 - elapsedSec * 7))

/** Nächstes Loch, nicht dasselbe wie zuvor. */
export function nextHole(prev: number | null, rng: Rng = Math.random): number {
  let h = Math.floor(rng() * MOLE_HOLES)
  if (h === prev) h = (h + 1 + Math.floor(rng() * (MOLE_HOLES - 1))) % MOLE_HOLES
  return h
}
