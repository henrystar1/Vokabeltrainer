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

export interface Bld { x: number; z: number; w: number; d: number; h: number; /** Unterkante (Sturz über einer Garageneinfahrt): darunter kann man durchfahren */ lo?: number; /** Farbvariante 0–5 */ c: number }
import { PARK } from './parkhaus'
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
  // Garagen-Häuser (Einfahrt mit Sturz über der Rampe) und Parkhaus-Block: die zufälligen Häuser dort werden ersetzt
  const clearBlock = (bx: number, bz: number) => {
    for (let i = buildings.length - 1; i >= 0; i--) if (Math.abs(buildings[i].x - bx) < 46 && Math.abs(buildings[i].z - bz) < 46) buildings.splice(i, 1)
    for (let i = parks.length - 1; i >= 0; i--) if (parks[i].x === bx && parks[i].z === bz) parks.splice(i, 1)
  }
  for (const g of GARAGES) {
    clearBlock(g.bx, g.bz)
    const t = TUNNELS[g.seg], hw = 9, S = 45, hgt = 22
    if (t.dir === 'z') {
      buildings.push({ x: (g.bx - S + t.c - hw) / 2, z: g.bz, w: t.c - hw - (g.bx - S), d: 2 * S, h: hgt, c: 0 }, { x: (t.c + hw + g.bx + S) / 2, z: g.bz, w: g.bx + S - (t.c + hw), d: 2 * S, h: hgt, c: 0 }, { x: t.c, z: g.bz, w: 2 * hw, d: 2 * S, h: hgt, lo: 6, c: 0 })
    } else {
      buildings.push({ x: g.bx, z: (g.bz - S + t.c - hw) / 2, w: 2 * S, d: t.c - hw - (g.bz - S), h: hgt, c: 0 }, { x: g.bx, z: (t.c + hw + g.bz + S) / 2, w: 2 * S, d: g.bz + S - (t.c + hw), h: hgt, c: 0 }, { x: g.bx, z: t.c, w: 2 * S, d: 2 * hw, h: hgt, lo: 6, c: 0 })
    }
  }
  clearBlock(PARK.cx, PARK.cz)
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

/** Dachhöhe des Hauses an diesem Punkt (0 = kein Haus): darauf kann man mit dem Flugmodus landen und fahren. */
export function roofH(x: number, z: number): number {
  if (Math.abs(x) > CITY.half || Math.abs(z) > CITY.half) return 0
  const c = city()
  const list = c.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
  if (!list) return 0
  let top = 0
  for (const i of list) { const b = c.buildings[i]; if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) top = Math.max(top, b.h) }
  return top
}

/** Außenbereich hinter der Nordmauer (Maße; Details und Berge in mountains.ts). */
export const OUTLAND = { x1: 900, z1: 2150, gate: 14 }

/** Liegt der Punkt in einem Gebäude (oder jenseits der Stadtmauer)? Gibt die Richtung nach draußen (Normale) und die Eindringtiefe zurück. */
export function cityPush(x: number, z: number): { nx: number; nz: number; depth: number; /** Dachhöhe bei Häusern: oberhalb davon ist nichts im Weg */ top?: number; /** Unterkante (Sturz): darunter kann man durchfahren */ lo?: number } | null {
  const H = CITY.half
  const o = OUTLAND
  // Außenwelt: Rechteck um die Stadt (Rennstrecke, Wiesen, Berge); Grenzen ringsum
  if (x > o.x1) return { nx: -1, nz: 0, depth: x - o.x1 }
  if (x < -o.x1) return { nx: 1, nz: 0, depth: -o.x1 - x }
  if (z > o.z1) return { nx: 0, nz: -1, depth: z - o.z1 }
  if (z < -o.x1) return { nx: 0, nz: 1, depth: -o.x1 - z }
  const m = Math.max(Math.abs(x), Math.abs(z))
  if (m > H + 2) return null
  if (m > H - 2) {
    // Stadtmauer (4 m dick); nur das Nordtor (x = 0) ist offen
    if (z > 0 && Math.abs(x) <= o.gate && Math.abs(z) >= Math.abs(x)) return null
    const ax = Math.abs(x) > Math.abs(z)
    const sg = ax ? Math.sign(x) : Math.sign(z)
    const out = m >= H
    const d = out ? H + 2 - m : m - (H - 2)
    const n = out ? sg : -sg
    return ax ? { nx: n, nz: 0, depth: d } : { nx: 0, nz: n, depth: d }
  }
  const c = city()
  const list = c.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
  if (!list) return null
  for (const i of list) {
    const b = c.buildings[i]
    const px = b.w / 2 - Math.abs(x - b.x), pz = b.d / 2 - Math.abs(z - b.z)
    if (px > 0 && pz > 0) return px < pz ? { nx: Math.sign(x - b.x) || 1, nz: 0, depth: px, top: b.h, lo: b.lo } : { nx: 0, nz: Math.sign(z - b.z) || 1, depth: pz, top: b.h, lo: b.lo }
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
/** r0/r1 = false: Ende ohne Rampe (geschlossen bzw. mündet in eine andere Röhre). Zufahrten gibt es nur als Garagen (siehe GARAGES). */
export interface TunnelSeg { dir: 'x' | 'z'; c: number; a0: number; a1: number; r0?: boolean; r1?: boolean }
const CLOSED = { r0: false, r1: false } as const
export const TUNNELS: ReadonlyArray<TunnelSeg> = [
  { dir: 'x', c: 120, a0: -480, a1: 480, ...CLOSED },
  { dir: 'x', c: -120, a0: -240, a1: 600, ...CLOSED },
  { dir: 'x', c: 360, a0: -600, a1: 120, ...CLOSED },
  { dir: 'x', c: -360, a0: -240, a1: 600, ...CLOSED },
  { dir: 'z', c: -360, a0: -600, a1: 600, ...CLOSED },
  { dir: 'z', c: -120, a0: -600, a1: 600, ...CLOSED },
  { dir: 'z', c: 0, a0: -600, a1: 600, ...CLOSED },
  { dir: 'z', c: 240, a0: -600, a1: 600, ...CLOSED },
  // Garagen: Einfahrt in ein Haus (Block), Rampe unter dem Haus nach unten, mündet in eine Straßenröhre
  { dir: 'z', c: 60, a0: 113, a1: 225, r0: false },
  { dir: 'z', c: -180, a0: 15, a1: 127, r1: false },
  { dir: 'z', c: 300, a0: -225, a1: -113, r1: false },
  { dir: 'z', c: -420, a0: 353, a1: 465, r0: false },
  { dir: 'z', c: 420, a0: -465, a1: -353, r1: false },
  { dir: 'x', c: -300, a0: -7, a1: 105, r0: false },
  { dir: 'x', c: 180, a0: -353, a1: -255, r0: false },
]
/** Garagen-Häuser: Block (Mitte), Achse und Tür (Blockkante, an der man von der Straße hineinfährt). */
export const GARAGES: ReadonlyArray<{ bx: number; bz: number; seg: number; door: { x: number; z: number }; out: { x: number; z: number }; inn: { x: number; z: number } }> = [
  { bx: 60, bz: 180, seg: 8, door: { x: 60, z: 225 }, out: { x: 60, z: 240 }, inn: { x: 60, z: 190 } },
  { bx: -180, bz: 60, seg: 9, door: { x: -180, z: 15 }, out: { x: -180, z: 0 }, inn: { x: -180, z: 50 } },
  { bx: 300, bz: -180, seg: 10, door: { x: 300, z: -225 }, out: { x: 300, z: -240 }, inn: { x: 300, z: -190 } },
  { bx: -420, bz: 420, seg: 11, door: { x: -420, z: 465 }, out: { x: -420, z: 480 }, inn: { x: -420, z: 430 } },
  { bx: 420, bz: -420, seg: 12, door: { x: 420, z: -465 }, out: { x: 420, z: -480 }, inn: { x: 420, z: -430 } },
  { bx: 60, bz: -300, seg: 13, door: { x: 105, z: -300 }, out: { x: 120, z: -300 }, inn: { x: 70, z: -300 } },
  { bx: -300, bz: 180, seg: 14, door: { x: -255, z: 180 }, out: { x: -240, z: 180 }, inn: { x: -290, z: 180 } },
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
  const u = Math.min(1, t.r0 === false ? 1 : (a - t.a0) / CITY.ramp, t.r1 === false ? 1 : (t.a1 - a) / CITY.ramp)
  return u * u * (3 - 2 * u)
}
/** Röhre, aber nur im Rampenbereich an den Enden (dort ist die Straße offen); in der Mitte fährt man oben ganz normal über sie. */
export function tunnelRamp(x: number, z: number): TunnelSeg | null {
  for (const t of TUNNELS) {
    if (!segIn(t, x, z)) continue
    const a = t.dir === 'x' ? x : z
    if ((t.r0 !== false && a - t.a0 < CITY.ramp) || (t.r1 !== false && t.a1 - a < CITY.ramp)) return t
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
