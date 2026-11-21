import { city, type Bld } from './city'
import { layoutOf } from './interior'

/** Besondere Häuser der Stadt: Bank (ausrauben), Shops (Vokabeln lernen → mehr Auto-Spawns), Fitnessstudios (Vokabeln lernen → mehr Leben). Feste Auswahl, auf Client und Server-unabhängig gleich. */
export type PoiKind = 'bank' | 'shop' | 'gym'
export interface Poi { id: string; kind: PoiKind; name: string; b: Bld; /** Tür (Welt) */ x: number; z: number }
export const POI_COLOR: Record<PoiKind, string> = { bank: '#facc15', shop: '#22d3ee', gym: '#f472b6' }
export const POI_LETTER: Record<PoiKind, string> = { bank: 'B', shop: 'S', gym: 'F' }
/** Reichweite um die Tür, in der man das Haus benutzen kann */
export const POI_RANGE = 7

let cache: Poi[] | null = null
export function pois(): Poi[] {
  if (cache) return cache
  const c = city()
  const ok = c.buildings.filter((b) => b.lo === undefined && Math.min(b.w, b.d) >= 30 && Math.abs(b.x) < 640 && Math.abs(b.z) < 640)
  const hash = (b: Bld) => { const s = Math.sin(b.x * 12.9898 + b.z * 78.233) * 43758.5453; return s - Math.floor(s) }
  const out: Poi[] = []
  const take = (kind: PoiKind, name: string, n: number, minGap: number, score: (b: Bld) => number) => {
    const list = [...ok].sort((a, b) => score(a) - score(b))
    let k = 0
    for (const b of list) {
      if (k >= n) break
      if (out.some((p) => Math.hypot(p.b.x - b.x, p.b.z - b.z) < minGap)) continue
      const d = layoutOf(b).door
      out.push({ id: `${kind}${k}`, kind, name: n > 1 ? `${name} ${k + 1}` : name, b, x: d.x, z: d.z })
      k++
    }
  }
  take('bank', 'Bank', 1, 0, (b) => Math.hypot(b.x - 180, b.z + 180))
  take('shop', 'Shop', 4, 260, (b) => hash(b))
  take('gym', 'Fitnessstudio', 2, 300, (b) => hash(b) + 1)
  cache = out
  return out
}

/** Nächstes Haus dieser Art in Reichweite der Tür (zu Fuß) */
export function poiNear(x: number, z: number, y = 0): Poi | null {
  for (const p of pois()) if (Math.hypot(p.x - x, p.z - z) < POI_RANGE && y < 4.5) return p
  return null
}
