/** Offene Stadt: Häuserblöcke mit Straßen und Gassen, Parks mit Wäldchen (zum Verstecken), Tunnel unter der Erde, Stadtmauer und mehrere Brücken (Rampen an beiden Enden, mit Flugautos auch von der Seite erreichbar). */
export const CITY = {
  pitch: 120, street: 24, half: 720,
  /** Blöcke je Richtung: von -K bis K-1 */
  K: 6,
  /** Brücken: Fahrbahn ±bw breit, Höhe bh, Rampenlänge ramp */
  bw: 8, bh: 5, ramp: 60,
  /** Tunnel: Breite der Röhre und Tiefe unter der Straße */
  tw: 14, td: 6,
}

/** Brücken über den Straßen z = bz, von bx0 bis bx1 (Enden liegen auf Kreuzungen, damit Querstraßen frei bleiben). */
export const BRIDGES: ReadonlyArray<{ bz: number; bx0: number; bx1: number }> = [
  { bz: 240, bx0: -360, bx1: 360 },
  { bz: -240, bx0: -600, bx1: 120 },
  { bz: 480, bx0: -240, bx1: 600 },
  { bz: -480, bx0: -120, bx1: 480 },
  { bz: 0, bx0: -240, bx1: 240 },
]

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
  for (let kx = -CITY.K; kx < CITY.K; kx++) for (let kz = -CITY.K; kz < CITY.K; kz++) {
    const cx = CITY.pitch * kx + CITY.pitch / 2, cz = CITY.pitch * kz + CITY.pitch / 2
    const t = r()
    const hgt = () => Math.round(10 + r() * r() * 50)
    if (t < 0.17) { parks.push({ x: cx, z: cz, size: SZ }); continue }
    if (t < 0.38) { buildings.push({ x: cx, z: cz, w: SZ - 10, d: SZ - 10, h: 25 + Math.round(r() * 40), c: Math.floor(r() * 6) }); continue }
    const lot = (SZ - ALLEY) / 2
    if (t < 0.65) {
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

/** Außenbereich hinter der Nordmauer (Maße; Details und Berge in mountains.ts). */
export const OUTLAND = { x1: 900, z1: 2150, gate: 14 }

/** Liegt der Punkt in einem Gebäude (oder jenseits der Stadtmauer)? Gibt die Richtung nach draußen (Normale) und die Eindringtiefe zurück. */
export function cityPush(x: number, z: number): { nx: number; nz: number; depth: number } | null {
  const H = CITY.half
  const o = OUTLAND
  // Außenbereich hinter dem Tor: eigene Grenzen; die Stadtmauer (Dicke 4 m) trennt ihn von der Stadt, nur das Tor ist offen
  if (z > H - 2 && Math.abs(x) <= o.x1 && z <= o.z1) {
    if (Math.abs(x) > o.gate && z < H + 2) return z >= H ? { nx: 0, nz: 1, depth: H + 2 - z } : { nx: 0, nz: -1, depth: z - (H - 2) }
    if (z > H) return null
  }
  if (z > H && Math.abs(x) <= o.x1 && z <= o.z1) return null
  if (z > H && Math.abs(x) <= o.x1) return { nx: 0, nz: -1, depth: z - o.z1 }
  if (z > H && x > o.x1) return { nx: -1, nz: 0, depth: x - o.x1 }
  if (z > H && x < -o.x1) return { nx: 1, nz: 0, depth: -o.x1 - x }
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

/** Brücke, deren Fahrbahn (Länge von bx0 bis bx1, Breite ±bw) den Punkt enthält. */
export function bridgeAt(x: number, z: number): { bz: number; bx0: number; bx1: number } | null {
  for (const b of BRIDGES) if (x >= b.bx0 && x <= b.bx1 && Math.abs(z - b.bz) <= CITY.bw) return b
  return null
}
/** Höhe der Brückenfahrbahn bei x auf der Brücke in der Straße z (0 außerhalb): sanfte Rampen, in der Mitte eben. */
export function bridgeH(x: number, z: number): number {
  const b = bridgeAt(x, z)
  if (!b) return 0
  const t = Math.min(1, Math.min(x - b.bx0, b.bx1 - x) / CITY.ramp)
  return CITY.bh * t * t * (3 - 2 * t)
}
/** Untergrund-Netz unter der Stadt: Röhren in Ost-West (dir 'x', c = z) und Nord-Süd (dir 'z', c = x) mit Kreuzungen; Einfahrten (Rampen) an den Enden. */
export interface TunnelSeg { dir: 'x' | 'z'; c: number; a0: number; a1: number }
export const TUNNELS: ReadonlyArray<TunnelSeg> = [
  { dir: 'x', c: 120, a0: -480, a1: 480 },
  { dir: 'x', c: -120, a0: -240, a1: 600 },
  { dir: 'x', c: 360, a0: -600, a1: 120 },
  { dir: 'x', c: -360, a0: -240, a1: 600 },
  { dir: 'z', c: -360, a0: -600, a1: 600 },
  { dir: 'z', c: -120, a0: -600, a1: 600 },
  { dir: 'z', c: 0, a0: -600, a1: 600 },
  { dir: 'z', c: 240, a0: -600, a1: 600 },
]
const segIn = (t: TunnelSeg, x: number, z: number, m = 0): boolean => {
  const a = t.dir === 'x' ? x : z, p = t.dir === 'x' ? z : x
  return a >= t.a0 && a <= t.a1 && Math.abs(p - t.c) <= CITY.tw / 2 - m
}
/** Röhre (irgendeine), in der der Punkt liegt. */
export function tunnelAt(x: number, z: number): TunnelSeg | null {
  for (const t of TUNNELS) if (segIn(t, x, z)) return t
  return null
}
const segU = (t: TunnelSeg, x: number, z: number): number => {
  const a = t.dir === 'x' ? x : z
  const u = Math.min(1, Math.min(a - t.a0, t.a1 - a) / CITY.ramp)
  return u * u * (3 - 2 * u)
}
/** Röhre, aber nur im Rampenbereich an den Enden (dort ist die Straße offen); in der Mitte fährt man oben ganz normal über sie. */
export function tunnelRamp(x: number, z: number): TunnelSeg | null {
  for (const t of TUNNELS) {
    if (!segIn(t, x, z)) continue
    const a = t.dir === 'x' ? x : z
    if (a - t.a0 < CITY.ramp || t.a1 - a < CITY.ramp) return t
  }
  return null
}
/** Tiefe der Tunnelsohle unter der Straße bei (x, z): 0 außerhalb, an den Enden Rampen, dazwischen eben (tiefste aller Röhren am Punkt). */
export function tunnelD(x: number, z: number): number {
  let d = 0
  for (const t of TUNNELS) if (segIn(t, x, z)) d = Math.max(d, CITY.td * segU(t, x, z))
  return d
}
/** Wandbegrenzung unter der Erde: nächster erlaubter Punkt innerhalb der Vereinigung aller Röhren (0.8 m Wandabstand); null wenn der Punkt schon frei ist. */
export function tunnelClamp(x: number, z: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null, bd = Infinity
  for (const t of TUNNELS) {
    const hw = CITY.tw / 2 - 0.8
    const ax = t.dir === 'x' ? Math.max(t.a0, Math.min(t.a1, x)) : Math.max(t.c - hw, Math.min(t.c + hw, x))
    const az = t.dir === 'z' ? Math.max(t.a0, Math.min(t.a1, z)) : Math.max(t.c - hw, Math.min(t.c + hw, z))
    const d = Math.hypot(ax - x, az - z)
    if (d < bd) { bd = d; best = { x: ax, z: az } }
  }
  return bd > 1e-6 ? best : null
}
export const onDeck = (x: number, z: number): boolean => bridgeAt(x, z) !== null
/** Liegt der Punkt in einem Park (Wäldchen)? Dort ist man zwischen den Bäumen versteckt. */
export function inPark(x: number, z: number): boolean {
  for (const p of city().parks) if (Math.abs(x - p.x) < p.size / 2 - 4 && Math.abs(z - p.z) < p.size / 2 - 4) return true
  return false
}
