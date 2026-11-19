import { MOUNTAINS, OUT, RING, hillH, outRoads, type Pt } from './mountains'

/** Wald an und um die Berge: feste (deterministische) Baumpositionen, abseits der Straßen. */
export interface Tree { x: number; z: number; s: number }
/** Stammradius für die Kollision (Meter). */
export const TREE_R = 1.1

let cache: Tree[] | null = null
let grid: Map<string, Tree[]> | null = null
const CELL = 24

function nearRoad(roads: Pt[][], x: number, z: number, lim: number): boolean {
  for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
    const [ax, az] = r[i], [bx, bz] = r[i + 1]
    if (Math.abs(ax - x) > lim + 14 && Math.abs(bx - x) > lim + 14) continue
    if (Math.abs(az - z) > lim + 14 && Math.abs(bz - z) > lim + 14) continue
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < lim) return true
  }
  return false
}

export function trees(): Tree[] {
  if (cache) return cache
  let seed = 90210
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const roads = outRoads()
  const out: Tree[] = []
  for (const m of MOUNTAINS) {
    const reach = m.R * 1.35, n = 2400
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * reach
      const x = m.x + r * Math.sin(a), z = m.z + r * Math.cos(a)
      if (x < OUT.x0 + 12 || x > OUT.x1 - 12 || z > OUT.z1 - 12 || z < RING.h + RING.w + 40) continue
      if (hillH(x, z) > m.H * 0.72) continue            // Gipfel bleiben kahl
      if (Math.abs(x) < 24) continue                      // Hauptstraße
      if (nearRoad(roads, x, z, 15)) continue
      out.push({ x, z, s: 0.8 + rnd() * 0.9 })
    }
  }
  cache = out
  return out
}

function gridOf(): Map<string, Tree[]> {
  if (grid) return grid
  const g = new Map<string, Tree[]>()
  for (const t of trees()) { const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`; const l = g.get(k); if (l) l.push(t); else g.set(k, [t]) }
  grid = g
  return g
}

/** Stößt ein Punkt gegen einen Baumstamm? Gibt die Richtung weg vom Stamm und die Eindringtiefe zurück. */
export function treePush(x: number, z: number): { nx: number; nz: number; depth: number } | null {
  if (z < RING.h) return null
  const g = gridOf(), ci = Math.floor(x / CELL), cj = Math.floor(z / CELL)
  let best: { nx: number; nz: number; depth: number } | null = null
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const l = g.get(`${i},${j}`)
    if (!l) continue
    for (const t of l) {
      const dx = x - t.x, dz = z - t.z, rr = TREE_R * t.s, d = Math.hypot(dx, dz)
      if (d < rr && (!best || rr - d > best.depth)) best = { nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0, depth: rr - d }
    }
  }
  return best
}
