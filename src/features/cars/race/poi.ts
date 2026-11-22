import { city, type Bld } from './city'
import { canon, layoutOf, setSpecial, type Solid } from './interior'

/** Besondere Häuser der Stadt mit Einrichtung: Bank (Tresen + Tresor), Shop (Theke), Fitnessstudio (Geräte), Krankenhaus (Betten, hier wacht man nach dem Tod auf). Feste Auswahl, überall gleich. */
export type PoiKind = 'bank' | 'shop' | 'gym' | 'hospital' | 'police'
export type SpotKind = 'vault' | 'counter' | 'machine' | 'armory' | 'steal'
export interface Spot { x: number; z: number; r: number; kind: SpotKind; label: string }
export interface Poi {
  id: string; kind: PoiKind; name: string; b: Bld
  /** Tür (Welt) und Blick nach draußen */
  x: number; z: number; nx: number; nz: number
  solids: Solid[]; spots: Spot[]
  /** Tresortür (Welt): Mitte, Blickrichtung in den Raum, Breite */
  vault?: { x: number; z: number; nx: number; nz: number; w: number }
  /** Bett-Plätze (Aufwachen nach dem Tod): Standort neben dem Bett und Blickrichtung */
  beds?: Array<{ x: number; z: number; h: number }>
}
export const POI_COLOR: Record<PoiKind, string> = { bank: '#facc15', shop: '#22d3ee', gym: '#f472b6', hospital: '#ef4444', police: '#3b82f6' }
export const POI_LETTER: Record<PoiKind, string> = { bank: 'B', shop: 'S', gym: 'F', hospital: '+', police: 'P' }
/** Reichweite um die Tür (Karte, Leuchtsäule) */
export const POI_RANGE = 7

let cache: Poi[] | null = null
export function pois(): Poi[] {
  if (cache) return cache
  const c = city()
  const ok = c.buildings.filter((b) => b.lo === undefined && Math.min(b.w, b.d) >= 40 && Math.abs(b.x) < 640 && Math.abs(b.z) < 640)
  const hash = (b: Bld, k = 0) => { const s = Math.sin(b.x * 12.9898 + b.z * 78.233 + k) * 43758.5453; return s - Math.floor(s) }
  const out: Poi[] = []
  const take = (kind: PoiKind, name: string, n: number, minGap: number, score: (b: Bld) => number) => {
    const list = [...ok].sort((a, b) => score(a) - score(b))
    let k = 0
    for (const b of list) {
      if (k >= n) break
      if (out.some((p) => Math.hypot(p.b.x - b.x, p.b.z - b.z) < minGap)) continue
      out.push(furnish({ id: `${kind}${k}`, kind, name: n > 1 ? `${name} ${k + 1}` : name, b, x: 0, z: 0, nx: 0, nz: 0, solids: [], spots: [] }))
      k++
    }
  }
  take('bank', 'Bank', 1, 0, (b) => Math.hypot(b.x - 180, b.z + 180))
  take('hospital', 'Krankenhaus', 1, 250, (b) => Math.hypot(b.x + 120, b.z - 120))
  { const b = c.buildings.find((q) => q.kind === 'police'); if (b) out.push(furnish({ id: 'police0', kind: 'police', name: 'Polizeiwache', b, x: 0, z: 0, nx: 0, nz: 0, solids: [], spots: [] })) }
  take('shop', 'Shop', 4, 260, (b) => hash(b))
  take('gym', 'Fitnessstudio', 2, 300, (b) => hash(b, 1) + 1)
  cache = out
  return out
}

/** Einrichtung eines Hauses in kanonischen Koordinaten (u quer, v Tiefe, Tür bei u = −W+10, v = −D) planen und in Weltquader umrechnen */
function furnish(p: Poi): Poi {
  const { cw, cd, toW } = canon(p.b)
  const W = cw / 2, D = cd / 2
  const rect = (u0: number, u1: number, v0: number, v1: number, h: number, color: number, o: Partial<Solid> = {}): Solid => {
    const a = toW(u0, v0), b = toW(u1, v1)
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), h, color, ...o }
  }
  const solids: Solid[] = [], spots: Spot[] = []
  const spot = (u: number, v: number, r: number, kind: SpotKind, label: string) => { const w = toW(u, v); spots.push({ x: w.x, z: w.z, r, kind, label }) }
  const wood = 0x8b5a2b
  if (p.kind === 'bank') {
    solids.push(rect(-W + 14, W - 13, -D + 11, -D + 12.4, 1.1, wood), rect(-W + 14, W - 13, -D + 11, -D + 12.4, 0.12, 0xfacc15, { y0: 1.1, deco: true }))
    solids.push(rect(W - 12, W - 1.5, D - 12, D - 1.5, 3.2, 0x4b5563))
    spot(W - 6.75, D - 14.4, 3.4, 'vault', 'Tresor öffnen')
    const m = toW(W - 6.75, D - 12), f = toW(W - 6.75, D - 13)
    const L = Math.hypot(f.x - m.x, f.z - m.z) || 1
    p.vault = { x: m.x, z: m.z, nx: (f.x - m.x) / L, nz: (f.z - m.z) / L, w: 5.4 }
  } else if (p.kind === 'shop') {
    solids.push(rect(-W + 12, W - 4, D - 9, D - 7.8, 1.1, wood), rect(-W + 12, W - 4, D - 9, D - 7.8, 0.12, 0xef4444, { y0: 1.1, deco: true }))
    for (const [u0, u1] of [[-W + 0.6, -W + 2], [W - 2, W - 0.6]] as const) {
      solids.push(rect(u0, u1, -D + 8, D - 12, 2.2, 0x64748b))
      const cols = [0xef4444, 0x22c55e, 0x3b82f6, 0xfacc15, 0xa855f7]
      for (let i = 0; i < 8; i++) solids.push(rect(u0 - 0.1, u1 + 0.1, -D + 9 + i * ((2 * D - 24) / 8), -D + 9.9 + i * ((2 * D - 24) / 8), 0.5, cols[i % cols.length], { y0: 0.4 + (i % 3) * 0.6, deco: true }))
    }
    spot(0, D - 11.5, 4.6, 'counter', 'Zur Theke')
  } else if (p.kind === 'gym') {
    for (let i = 0; i < 3; i++) {
      const u = -W + 8 + i * 5
      solids.push(rect(u, u + 1.0, D - 7.2, D - 4.8, 0.3, 0x1f2937), rect(u, u + 1.0, D - 4.9, D - 4.6, 1.5, 0x94a3b8), rect(u + 0.1, u + 0.9, D - 7.0, D - 5.0, 0.06, 0x111827, { y0: 0.3, deco: true }))
      spot(u + 0.5, D - 8.4, 2.4, 'machine', 'Laufband')
    }
    for (let i = 0; i < 2; i++) {
      const u = -W + 10 + i * 7
      solids.push(rect(u, u + 0.6, -1.1, 1.1, 0.5, 0x374151), rect(u - 0.5, u - 0.3, -0.9, -0.7, 1.4, 0x9ca3af), rect(u + 0.9, u + 1.1, -0.9, -0.7, 1.4, 0x9ca3af), rect(u - 0.8, u + 1.4, -0.9, -0.85, 0.06, 0x111827, { y0: 1.35, deco: true }), rect(u - 0.9, u - 0.6, -1.4, -0.9, 0.5, 0xef4444, { y0: 1.2, deco: true }), rect(u + 1.2, u + 1.5, -1.4, -0.9, 0.5, 0xef4444, { y0: 1.2, deco: true }))
      spot(u + 0.3, -2.8, 2.4, 'machine', 'Hantelbank')
    }
    for (let i = 0; i < 2; i++) {
      const u = W - 8 - i * 5
      solids.push(rect(u, u + 0.5, -D + 13, -D + 14.2, 1.1, 0x2563eb), rect(u + 0.1, u + 0.4, -D + 13, -D + 13.2, 1.5, 0x94a3b8))
      spot(u + 0.25, -D + 16, 2.4, 'machine', 'Fahrrad')
    }
    solids.push(rect(W - 2, W - 0.8, -D + 20, -D + 28, 0.9, 0x6b7280), rect(W - 2.1, W - 0.7, -D + 20.4, -D + 21.4, 0.3, 0x111827, { y0: 0.9, deco: true }))
    spot(W - 4, -D + 24, 2.6, 'machine', 'Hanteln')
  } else if (p.kind === 'police') {
    // Empfangstresen, Zellen an der Rückwand, Waffenkammer (Schlagstock) und Schlüsselbrett für den SWAT-Wagen
    solids.push(rect(-W + 14, W - 22, -D + 11, -D + 12.4, 1.1, 0x64748b), rect(-W + 14, W - 22, -D + 11, -D + 12.4, 0.12, 0x3b82f6, { y0: 1.1, deco: true }))
    for (let i = 0; i < 3; i++) {
      const u = -W + 6 + i * 9
      solids.push(rect(u, u + 6, D - 1.4, D - 0.6, 2.6, 0x475569), rect(u, u + 0.3, D - 6, D - 1.4, 2.6, 0x94a3b8), rect(u + 5.7, u + 6, D - 6, D - 1.4, 2.6, 0x94a3b8), rect(u, u + 6, D - 6, D - 5.7, 2.6, 0x94a3b8), rect(u + 1, u + 3.2, D - 3.2, D - 1.6, 0.5, 0x6b7280))
    }
    solids.push(rect(W - 12, W - 1.5, D - 12, D - 1.5, 2.4, 0x1e293b), rect(W - 11, W - 2.5, D - 12.1, D - 11.8, 1.2, 0x3b82f6, { y0: 1.0, deco: true }))
    spot(W - 6.75, D - 14.4, 3.4, 'armory', 'Waffenkammer aufbrechen')
    solids.push(rect(-W + 0.6, -W + 1.6, 4, 9, 1.8, 0x7c2d12), rect(-W + 0.5, -W + 1.7, 4.4, 8.6, 0.5, 0xfacc15, { y0: 1.0, deco: true }))
    spot(-W + 4, 6.5, 3.2, 'steal', 'SWAT-Wagen klauen')
  } else {
    const beds: NonNullable<Poi['beds']> = []
    let i = 0
    for (let u = -W + 8; u + 3 < W - 3 && i < 12; u += 5) for (let v = -D + 10; v + 3 < D - 3 && i < 12; v += 6) {
      solids.push(rect(u, u + 1.0, v, v + 2.1, 0.55, 0xf8fafc), rect(u, u + 1.0, v + 2.1, v + 2.25, 1.1, 0x94a3b8), rect(u + 0.1, u + 0.9, v + 1.5, v + 2.0, 0.15, 0xdbeafe, { y0: 0.55, deco: true }))
      const w = toW(u - 1.1, v + 1.0)
      beds.push({ x: w.x, z: w.z, h: Math.atan2(toW(u, v + 1).x - w.x, toW(u, v + 1).z - w.z) })
      i++
    }
    solids.push(rect(W - 10, W - 2, -D + 4, -D + 5.2, 1.1, 0xe5e7eb), rect(W - 10, W - 2, -D + 4, -D + 5.2, 0.12, 0xef4444, { y0: 1.1, deco: true }))
    p.beds = beds
  }
  setSpecial(p.b, solids)
  const d = layoutOf(p.b).door
  return { ...p, x: d.x, z: d.z, nx: d.nx, nz: d.nz, solids, spots }
}

/** Haus-Daten zu einem Gebäude (für die Innenansicht) */
export const poiOf = (b: Bld): Poi | null => pois().find((p) => p.b === b) ?? null

/** Nächstes Haus in Reichweite der Tür (Karte, Hinweis) */
export function poiNear(x: number, z: number, y = 0): Poi | null {
  for (const p of pois()) if (Math.hypot(p.x - x, p.z - z) < POI_RANGE && y < 4.5) return p
  return null
}

/** Bedienstelle (Tresor, Theke, Gerät) in Reichweite, wenn man im Haus steht */
export function spotNear(x: number, z: number, y = 0): { poi: Poi; spot: Spot } | null {
  if (y > 3) return null
  let best: { poi: Poi; spot: Spot; d: number } | null = null
  for (const p of pois()) for (const s of p.spots) {
    const d = Math.hypot(s.x - x, s.z - z)
    if (d < s.r && (!best || d < best.d)) best = { poi: p, spot: s, d }
  }
  return best
}

/** Aufwachplatz im Krankenhaus (zufälliges Bett) */
export function hospitalBed(): { x: number; z: number; h: number } {
  const h = pois().find((p) => p.kind === 'hospital')
  const beds = h?.beds ?? []
  if (!beds.length) return { x: 0, z: 0, h: 0 }
  return beds[Math.floor(Math.random() * beds.length)]
}
