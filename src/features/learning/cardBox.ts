import { MAX_LEVEL, displayLevel } from './algorithm'
import type { CardBoxItem } from '../../services/learning'

export const FACH_COUNT = MAX_LEVEL

/** Farbe von Rot (Fach 1) bis Grün (Fach 5). */
export function fachColor(fach: number): string {
  const t = (Math.min(Math.max(fach, 1), FACH_COUNT) - 1) / (FACH_COUNT - 1)
  return `hsl(${Math.round(t * 130)} 75% 52%)`
}

/** Trefferquote 0–1 (null = noch nie abgefragt). */
export function hitRate(c: Pick<CardBoxItem, 'right' | 'wrong'>): number | null {
  const n = c.right + c.wrong
  return n === 0 ? null : c.right / n
}

/** Farbe nach Trefferquote: 0 % rot → 100 % grün; ungeübt grau. */
export function rateColor(c: Pick<CardBoxItem, 'right' | 'wrong'>): string {
  const r = hitRate(c)
  return r === null ? 'hsl(215 15% 45%)' : `hsl(${Math.round(r * 130)} 75% 52%)`
}

export function groupByFach(cards: CardBoxItem[]): CardBoxItem[][] {
  const out: CardBoxItem[][] = Array.from({ length: FACH_COUNT }, () => [])
  for (const c of cards) out[displayLevel(c.level) - 1].push(c)
  return out
}

export interface RewardPreview { points: number; coins: number }

/** Grobe Vorschau für eine Runde mit lauter richtigen Antworten. Multiplikator wirkt wie auf dem Server beim Verdienen. */
export function previewReward(rules: Record<string, number>, answers: number, publicBook: boolean, pointsMult: number, coinsMult: number): { base: RewardPreview; boosted: RewardPreview } {
  const pts = Math.max(0, answers) * (rules.points_per_answer ?? 0)
  const coins = publicBook ? Math.min(Math.floor(answers / Math.max(rules.learn_coin_every ?? 5, 1)), rules.learn_coin_cap ?? 20) : 0
  return {
    base: { points: pts, coins },
    boosted: { points: Math.round(pts * Math.max(pointsMult, 1)), coins: Math.round(coins * Math.max(coinsMult, 1)) },
  }
}
