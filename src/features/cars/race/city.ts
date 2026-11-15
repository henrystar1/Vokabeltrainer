/** Offene Stadt: Häuserblöcke mit Straßen und Gassen, Parks, Stadtmauer und eine Brücke (Rampen an beiden Enden, mit Flugautos auch von der Seite erreichbar). */
export const CITY = {
  pitch: 120, street: 24, half: 492,
  /** Brücke: liegt über der Straße z = bz, von bx0 bis bx1, Fahrbahn ±bw breit, Höhe bh, Rampenlänge ramp */
  bz: 240, bx0: -360, bx1: 360, bw: 8, bh: 5, ramp: 60,
}

export interface Bld { x: number; z: number; w: number; d: number; h: number; /** Farbvariante 0–5 */ c: number }
export interface CityData { buildings: Bld[]; parks: Array<{ x: number; z: number; size: number }>; grid: Map<string, number[]> }

const CELL = 40
let cache: CityData | null = null

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function city(): CityData {
  if (cache) return cache
  const r = rng(20261115)
  const buildings: Bld[] = [], parks: CityData['parks'] = []
  const SZ = 90, ALLEY = 8
  for (let kx = -4; kx <= 3; kx++) for (let kz = -4; kz <= 3; kz++) {
    const cx = CITY.pitch * kx + CITY.pitch / 2, cz = CITY.pitch * kz + CITY.pitch / 2
    const t = r()
    const hgt = () => Math.round(10 + r() * r() * 50)
    if (t < 0.12) { parks.push({ x: cx, z: cz, size: SZ }); continue }
    if (t < 0.3) { buildings.push({ x: cx, z: cz, w: SZ - 10, d: SZ - 10, h: 25 + Math.round(r() * 40), c: Math.floor(r() * 6) }); continue }
    const lot = (SZ - ALLEY) / 2
    if (t < 0.6) {
      // zwei Gebäude, eine Gasse dazwischen (Richtung zufällig)
      const alongX = r() < 0.5
      for (const s of [-1, 1]) buildings.push(alongX
        ? { x: cx, z: cz + s * (ALLEY / 2 + lot / 2), w: SZ, d: lot, h: hgt(), c: Math.floor(r() * 6) }
        : { x: cx + s * (ALLEY / 2 + lot / 2), z: cz, w: lot, d: SZ, h: hgt(), c: Math.floor(r() * 6) })
      continue
    }
    // vier Gebäude, Gassen kreuzen sich in der Mitte
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) buildings.push({ x: cx + sx * (ALLEY / 2 + lot / 2), z: cz + sz * (ALLEY / 2 + lot / 2), w: lot, d: lot, h: hgt(), c: Math.floor(r() * 6) })
  }
  const grid = new Map<string, number[]>()
  buildings.forEach((b, i) => {
    for (let gx = Math.floor((b.x - b.w / 2) / CELL); gx <= Math.floor((b.x + b.w / 2) / CELL); gx++)
      for (let gz = Math.floor((b.z - b.d / 2) / CELL); gz <= Math.floor((b.z + b.d / 2) / CELL); gz++) {
        const k = `${gx},${gz}`; const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i])
      }
  })
  cache = { buildings, parks, grid }
  return cache
}

/** Liegt der Punkt in einem Gebäude (oder jenseits der Stadtmauer)? Gibt die Richtung nach draußen (Normale) und die Eindringtiefe zurück. */
export function cityPush(x: number, z: number): { nx: number; nz: number; depth: number } | null {
  const H = CITY.half
  if (Math.abs(x) > H || Math.abs(z) > H) {
    if (Math.abs(x) - H > Math.abs(z) - H) return { nx: -Math.sign(x), nz: 0, depth: Math.abs(x) - H }
    return { nx: 0, nz: -Math.sign(z), depth: Math.abs(z) - H }
  }
  const c = city()
  const list = c.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
  if (!list) return null
  for (const i of list) {
    const b = c.buildings[i]
    const px = b.w / 2 - Math.abs(x - b.x), pz = b.d / 2 - Math.abs(z - b.z)
    if (px > 0 && pz > 0) return px < pz ? { nx: Math.sign(x - b.x) || 1, nz: 0, depth: px } : { nx: 0, nz: Math.sign(z - b.z) || 1, depth: pz }
  }
  return null
}

/** Höhe der Brückenfahrbahn bei x (0 außerhalb): sanfte Rampen, in der Mitte eben. */
export function bridgeH(x: number): number {
  if (x < CITY.bx0 || x > CITY.bx1) return 0
  const t = Math.min(1, Math.min(x - CITY.bx0, CITY.bx1 - x) / CITY.ramp)
  return CITY.bh * t * t * (3 - 2 * t)
}
export const onDeck = (x: number, z: number): boolean => x >= CITY.bx0 && x <= CITY.bx1 && Math.abs(z - CITY.bz) <= CITY.bw
