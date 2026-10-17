import type { Rng } from '../learning/random'

export const MOLE_HOLES = 9
export const MOLE_LIVES = 3
export const MOLE_MAX_LIVES = 5
/** Treffer in Folge (normale Maulwürfe), die ein Herz zurückgeben. */
export const MOLE_STREAK_HEAL = 12

export type MoleKind = 'normal' | 'golden' | 'bomb'

/** Wie lange ein Maulwurf oben bleibt (ms): sinkt bis 640 ms (bei ~55 Punkten) und bleibt dann gleich – gut machbar mit dem Finger. */
export const moleUpTime = (score: number): number => Math.max(640, Math.round(1300 - score * 12))

/** Pause bis zum nächsten Auftauchen (ms), bleibt ab ~35 Punkten bei 300. */
export const moleGap = (score: number): number => Math.max(300, Math.round(620 - score * 9))

/** Wie viele gleichzeitig oben sein dürfen: 1, ab 20 Punkten 2, ab 60 Punkten 3. */
export const moleMaxUp = (score: number): number => (score >= 60 ? 3 : score >= 20 ? 2 : 1)

/** Art des nächsten Maulwurfs: ab 8 Punkten Bomben (bis 22 %), selten goldene (+3). */
export function pickKind(score: number, rng: Rng = Math.random): MoleKind {
  const r = rng()
  const bomb = score >= 8 ? Math.min(0.22, 0.08 + (score - 8) * 0.004) : 0
  if (r < bomb) return 'bomb'
  if (r < bomb + 0.08) return 'golden'
  return 'normal'
}

export const molePoints = (kind: MoleKind): number => (kind === 'golden' ? 3 : kind === 'normal' ? 1 : 0)

/** Freies Loch (nicht in `taken`), zufällig. */
export function freeHole(taken: ReadonlySet<number>, rng: Rng = Math.random): number | null {
  const free = Array.from({ length: MOLE_HOLES }, (_, i) => i).filter((i) => !taken.has(i))
  return free.length ? free[Math.floor(rng() * free.length)] : null
}
