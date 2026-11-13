/** Hitboxen: gedrehte Rechtecke (Länge × Breite) mit Trennachsen-Test, Schaden aus der Aufprallgeschwindigkeit. */
export interface Box { x: number; z: number; h: number; l: number; w: number }
export interface Hit { nx: number; nz: number; depth: number }

/** Die vier Ecken der Karosserie. */
export function corners(b: Box): Array<[number, number]> {
  const fx = Math.sin(b.h), fz = Math.cos(b.h), rx = Math.cos(b.h), rz = -Math.sin(b.h)
  const hl = b.l / 2, hw = b.w / 2
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([a, c]) => [b.x + fx * hl * a + rx * hw * c, b.z + fz * hl * a + rz * hw * c] as [number, number])
}

/** Überschneiden sich zwei Autos? Normale zeigt von `b` zu `a`, depth = kleinste Verschiebung zum Trennen. */
export function boxHit(a: Box, b: Box): Hit | null {
  const dx = a.x - b.x, dz = a.z - b.z
  const reach = (a.l + a.w + b.l + b.w) / 2
  if (dx * dx + dz * dz > reach * reach) return null
  const axes: Array<[number, number]> = [[Math.sin(a.h), Math.cos(a.h)], [Math.cos(a.h), -Math.sin(a.h)], [Math.sin(b.h), Math.cos(b.h)], [Math.cos(b.h), -Math.sin(b.h)]]
  const rad = (box: Box, ax: number, az: number) => Math.abs((Math.sin(box.h) * ax + Math.cos(box.h) * az)) * box.l / 2 + Math.abs((Math.cos(box.h) * ax - Math.sin(box.h) * az)) * box.w / 2
  let best = Infinity, bx = 0, bz = 0
  for (const [ax, az] of axes) {
    const dist = Math.abs(dx * ax + dz * az)
    const over = rad(a, ax, az) + rad(b, ax, az) - dist
    if (over <= 0) return null
    if (over < best) { best = over; bx = ax; bz = az }
  }
  if (dx * bx + dz * bz < 0) { bx = -bx; bz = -bz }
  return { nx: bx, nz: bz, depth: best }
}

/** Schaden (Punkte von 0 bis 100) aus der Aufprallgeschwindigkeit in m/s: unter 3 m/s nur Kratzer. */
export const impactDamage = (vn: number): number => Math.max(0, Math.abs(vn) - 3) * 0.8
