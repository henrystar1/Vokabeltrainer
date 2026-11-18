import { CITY } from './city'

/** Gelände hinter der Stadt: Außenbereich nördlich der Stadtmauer (Tor in der Mitte) mit drei Bergen und Straßen darüber. */
export const OUT = { x0: -900, x1: 900, z0: CITY.half, z1: 2150 }
/** Halbe Breite der Toröffnung in der Stadtmauer (Nordseite, Straße x = 0). */
export const GATE = 14
/** Gesamte Spielwelt (für die Karte): Stadt plus Außenbereich. */
export const WORLD = { x0: -900, x1: 900, z0: -CITY.half, z1: OUT.z1 }

export interface Mountain { x: number; z: number; R: number; H: number; a0: number; dir: 1 | -1; turns: number }
/** Winkel a: Punkt = (x + r·sin a, z + r·cos a). Die Serpentine beginnt am Fuß auf der Seite der Hauptstraße. */
export const MOUNTAINS: ReadonlyArray<Mountain> = [
  { x: -480, z: 1250, R: 330, H: 110, a0: Math.PI / 2, dir: -1, turns: 1.5 },
  { x: 480, z: 1250, R: 330, H: 110, a0: -Math.PI / 2, dir: 1, turns: 1.5 },
  { x: 0, z: 1750, R: 330, H: 130, a0: Math.PI, dir: 1, turns: 1.75 },
]
const sm = (t: number) => t * t * (3 - 2 * t)
/** Höhe des Geländes bei (x, z): 0 überall außer an den Bergen (glatte Kuppen, oben fast flach). */
export function hillH(x: number, z: number): number {
  if (z < OUT.z0) return 0
  let h = 0
  for (const m of MOUNTAINS) {
    const r = Math.hypot(x - m.x, z - m.z)
    if (r < m.R) h = Math.max(h, m.H * sm(1 - r / m.R))
  }
  return h
}
/** Steigung (Höhe pro Meter) in Blickrichtung h. */
export function hillSlope(x: number, z: number, h: number): number {
  const d = 2.2
  return (hillH(x + Math.sin(h) * d, z + Math.cos(h) * d) - hillH(x - Math.sin(h) * d, z - Math.cos(h) * d)) / (2 * d)
}
export type Pt = [number, number]
/** Serpentinenstraße eines Berges von unten nach oben. */
export function spiral(m: Mountain, step = 6): Pt[] {
  const pts: Pt[] = []
  const rOf = (t: number) => m.R * (0.96 - 0.84 * t)
  const len = Math.PI * 2 * m.turns * m.R * 0.5
  const n = Math.ceil(len / step)
  for (let i = 0; i <= n; i++) { const t = i / n, a = m.a0 + m.dir * m.turns * Math.PI * 2 * t, r = rOf(t); pts.push([m.x + r * Math.sin(a), m.z + r * Math.cos(a)]) }
  return pts
}
/** Alle Straßen im Außenbereich: Hauptstraße vom Tor, Abzweige zu den Bergen und die Serpentinen. */
export function outRoads(): Pt[][] {
  const line = (a: Pt, b: Pt): Pt[] => { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12)); return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt) }
  const roads: Pt[][] = [line([0, CITY.half], [0, 1750 - 0.96 * 330])]
  for (const m of MOUNTAINS) {
    const s = spiral(m)
    if (m.z === 1250) roads.push(line([0, 1250], s[0]))
    roads.push(s)
  }
  return roads
}
/** Liegt der Punkt im Außenbereich (hinter dem Tor/der Mauer)? */
export const inOutland = (x: number, z: number): boolean => z > OUT.z0 && z <= OUT.z1 && x >= OUT.x0 && x <= OUT.x1
