import type { Ship, ShipsShot } from '../../services/online'

export const FLEET = [5, 4, 3, 3, 2]
export const SIZE = 10

export function shipCells(s: Ship): number[] {
  return Array.from({ length: s.len }, (_, k) => (s.h ? s.r * SIZE + s.c + k : (s.r + k) * SIZE + s.c))
}

/** Passt das Schiff aufs Feld und überlappt keins der anderen? */
export function canPlace(ship: Ship, others: Ship[]): boolean {
  if (ship.r < 0 || ship.c < 0 || ship.r >= SIZE || ship.c >= SIZE) return false
  if (ship.h ? ship.c + ship.len > SIZE : ship.r + ship.len > SIZE) return false
  const used = new Set(others.flatMap(shipCells))
  return shipCells(ship).every((c) => !used.has(c))
}

/** Zufällige gültige Flotte (rnd: Zufallsquelle 0..1, zum Testen austauschbar). */
export function randomFleet(rnd: () => number = Math.random): Ship[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const out: Ship[] = []
    let ok = true
    for (const len of FLEET) {
      let placed = false
      for (let t = 0; t < 100 && !placed; t++) {
        const s: Ship = { len, h: rnd() < 0.5, r: Math.floor(rnd() * SIZE), c: Math.floor(rnd() * SIZE) }
        if (canPlace(s, out)) { out.push(s); placed = true }
      }
      if (!placed) { ok = false; break }
    }
    if (ok) return out
  }
  throw new Error('Keine Anordnung gefunden')
}

/** Felder, die der Gegner bei mir getroffen hat (für die Anzeige meiner Flotte). */
export function hitSet(shots: ShipsShot[]): Set<number> {
  return new Set(shots.filter((s) => s.res !== 'miss').map((s) => s.r * SIZE + s.c))
}
