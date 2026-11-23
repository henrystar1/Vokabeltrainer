import { buildingAt, layoutOf } from './interior'

/** Weglänge bis zur ersten Hauswand auf der Schusslinie (Infinity = frei). Beide Enden im selben Haus: Innenwände zählen nicht.
 *  Bank (Glas) und Zaun lassen Kugeln durch, Türen sind offen, Dächer sind frei. */
export function shotWallT(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const L = Math.hypot(bx - ax, by - ay, bz - az)
  if (L < 1) return Infinity
  const sIn = buildingAt(ax, az), tIn = buildingAt(bx, bz)
  for (let t = 0.8; t < L; t += 0.8) {
    const k = t / L, px = ax + (bx - ax) * k, py = ay + (by - ay) * k, pz = az + (bz - az) * k
    const b = buildingAt(px, pz)
    if (!b || py >= b.h) continue
    if (b.kind === 'bank' || (b.kind === 'army' && b.w >= 80)) continue
    if (b === sIn && b === tIn) continue
    if (b === sIn && t < 2.5) continue
    // Tür: offene Lücke im Erdgeschoss
    const d = layoutOf(b).door
    if (py < 2.7 && Math.hypot(px - d.x, pz - d.z) < 2.2) continue
    return t
  }
  return Infinity
}
export const shotBlocked = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => shotWallT(ax, ay, az, bx, by, bz) < Math.hypot(bx - ax, by - ay, bz - az) - 1.5
