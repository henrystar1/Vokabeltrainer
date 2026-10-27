import { rng } from './generator'
import { ROWS, TILE, type Level } from './levels'

/** Boden-Upgrades: liegen auf dem Boden, sind für alle gleich (aus Lauf-ID und Level), kurz nutzbar. */
export type PickupKind = 'jump3' | 'jet'
export interface Pickup { id: number; kind: PickupKind; col: number }

export const PICKUP_INFO: Record<PickupKind, { name: string; color: string; glyph: string; seconds: number }> = {
  jump3: { name: '3er-Sprung', color: '#a78bfa', glyph: '3', seconds: 20 },
  jet: { name: 'Jetpack', color: '#fb923c', glyph: '🚀', seconds: 12 },
}

const free = (lv: Level, col: number): boolean => {
  if (col < 1 || col >= lv.cols - 1) return false
  for (let y = 5; y <= 9; y++) if (lv.rows[y][col] !== '.') return false
  return lv.rows[10][col] === '#'
}

/** Orte für Upgrades: freie Bodenkacheln mit Abstand zu Platten, Türen, Checkpoints und Ausgang. */
export function pickupsFor(level: Level, key: string): Pickup[] {
  const r = rng(`${key}:pk:${level.name}`)
  const out: Pickup[] = []
  const near = (col: number): boolean => {
    for (let dx = -1; dx <= 1; dx++) {
      const c = col + dx
      if (c < 0 || c >= level.cols) continue
      for (let y = 0; y < ROWS - 1; y++) {
        const ch = level.rows[y][c]
        if (ch === '^' || (ch >= 'a' && ch <= 'c') || (ch >= 'A' && ch <= 'C') || ch === 'k' || ch === 'X' || ch === 'J') return true
      }
    }
    return false
  }
  let col = 36 + Math.floor(r() * 30)
  let id = 0
  while (col < level.cols - 10) {
    let c = col
    while (c < col + 14 && !(free(level, c) && !near(c))) c++
    if (c < col + 14) {
      out.push({ id: id++, kind: r() < 0.5 ? 'jump3' : 'jet', col: c })
      col = c + 70 + Math.floor(r() * 30)
    } else col += 14
  }
  return out
}

export const pickupX = (p: Pickup): number => p.col * TILE + TILE / 2
export const pickupY = (): number => 9 * TILE + 16
