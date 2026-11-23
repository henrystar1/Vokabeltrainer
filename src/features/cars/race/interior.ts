import { CITY, CELL, city, type Bld } from './city'
import { inGlassHole } from './glass'

/** Innenräume der Häuser (nur zu Fuß): Tür zur Straße, Treppenhaus mit gegenläufigen Treppen, mehrere Zimmer. Rein rechnerisch aus der Gebäudegröße (feste Aufteilung je Haus). */
export const FLOOR_H = 3.6
const T_OUT = 0.5, T_IN = 0.3, DOOR_W = 3.0, GAP_W = 2.4, STAIR_W = 2.4

export interface Rect { x0: number; x1: number; z0: number; z1: number }
/** Einrichtung (Tresen, Geräte, Betten …): feste Quader, die den Weg versperren (bis Höhe y0 + h) und im Innenraum gezeichnet werden */
export interface Solid extends Rect { h: number; color: number; y0?: number; /** nur Anzeige, keine Kollision */ deco?: boolean }
export interface Flight { k: number; /** Spur (Welt) */ lane: Rect; /** Steigung entlang z (+1) oder −z (−1) */ dir: 1 | -1; lo: number; hi: number }
export interface Layout {
  b: Bld
  floors: number
  /** Geschosshöhe (Standard FLOOR_H; Bank und Kaserne sind höher) */
  fh: number
  /** Außenwände Erdgeschoss (mit Türöffnung) und obere Geschosse (geschlossen), Zwischenwände */
  outerG: Rect[]; outerUp: Rect[]; inner: Rect[]
  door: { x: number; z: number; nx: number; nz: number }
  flights: Flight[]
  /** Treppenzelle (für Lichtlöcher und Anzeige) */
  stairCell: Rect
  /** Türlücken zwischen Zimmerzellen (Weltkoordinaten) und Zellenraster für die Wegfindung */
  gaps: Array<{ a: number; b: number; x: number; z: number }>
  nx: number; nz: number
  solids: Solid[]
  cellOf: (x: number, z: number) => number
}

/** Gebäude, das den Punkt enthält (Garagenhäuser mit Sturz zählen nicht). */
export function buildingAt(x: number, z: number): Bld | null {
  if (Math.abs(x) > CITY.half || Math.abs(z) > CITY.half) return null
  const c = city()
  const list = c.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
  if (!list) return null
  for (const i of list) { const b = c.buildings[i]; if (b.lo === undefined && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b }
  return null
}

/** Welche Seite hat die Tür? 0 = Süden (−z), 1 = Westen (−x), 2 = Norden (+z), 3 = Osten (+x): zur nächsten Straße (zum Blockrand) hin. */
export function doorSide(b: Bld): 0 | 1 | 2 | 3 {
  if (b.door !== undefined) return b.door
  const P = CITY.pitch
  const cx = P * Math.floor(b.x / P) + P / 2, cz = P * Math.floor(b.z / P) + P / 2
  const ox = b.x - cx, oz = b.z - cz
  if (Math.abs(ox) >= Math.abs(oz) && Math.abs(ox) > 3) return ox > 0 ? 3 : 1
  if (Math.abs(oz) > 3) return oz > 0 ? 2 : 0
  return 0
}

const cache = new WeakMap<Bld, Layout>()
const specials = new WeakMap<Bld, Solid[]>()
/** Haus als Halle mit Einrichtung (Bank, Shop, Fitnessstudio, Krankenhaus): ein großer Raum, ein Geschoss, keine Treppen. */
export function setSpecial(b: Bld, solids: Solid[], opts?: { floors: number; fh: number; stair: number }): void { specials.set(b, solids); if (opts) specialOpts.set(b, opts); cache.delete(b) }
const specialOpts = new WeakMap<Bld, { floors: number; fh: number; stair: number }>()
/** Kanonische Hausmaße (Tür im Süden bei Querposition −w/2+10): Breite cw, Tiefe cd und Umrechnung (u quer, v Tiefe) → Welt */
export function canon(b: Bld): { cw: number; cd: number; toW: (u: number, v: number) => { x: number; z: number } } {
  const rot = doorSide(b), swap = rot % 2 === 1
  const cw = swap ? b.d : b.w, cd = swap ? b.w : b.d
  return { cw, cd, toW: (u, v) => { const p = rot === 0 ? [u, v] : rot === 1 ? [v, -u] : rot === 2 ? [-u, -v] : [-v, u]; return { x: b.x + p[0], z: b.z + p[1] } } }
}
const hash = (b: Bld, a: number, c: number) => { const s = Math.sin(b.x * 12.9898 + b.z * 78.233 + a * 37.719 + c * 11.13) * 43758.5453; return s - Math.floor(s) }

export function layoutOf(b: Bld): Layout {
  const hit = cache.get(b)
  if (hit) return hit
  const rot = doorSide(b)
  const swap = rot % 2 === 1
  const cw = swap ? b.d : b.w, cd = swap ? b.w : b.d
  const hw = cw / 2, hd = cd / 2
  const hall = specials.has(b)
  const so = specialOpts.get(b)
  const fh = so?.fh ?? FLOOR_H
  const nx = hall ? 1 : Math.max(1, Math.floor(cw / 16)), nz = hall ? 1 : Math.max(1, Math.floor(cd / 16))
  const cwid = cw / nx, cdep = cd / nz
  // kanonisch: Tür im Süden (v = −hd); Welt = Drehung um das Gebäudezentrum
  const toWorld = (r: Rect): Rect => {
    const pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].map(([u, v]) => rot === 0 ? [u, v] : rot === 1 ? [v, -u] : rot === 2 ? [-u, -v] : [-v, u])
    return { x0: b.x + Math.min(...pts.map((p) => p[0])), x1: b.x + Math.max(...pts.map((p) => p[0])), z0: b.z + Math.min(...pts.map((p) => p[1])), z1: b.z + Math.max(...pts.map((p) => p[1])) }
  }
  const outerC: Rect[] = [], outerUpC: Rect[] = [], innerC: Rect[] = []
  const gapsC: Array<{ a: number; b: number; u: number; v: number }> = []
  const doorU = -hw + 10
  // Süd (Tür), Nord, West, Ost
  outerC.push({ x0: -hw, x1: doorU - DOOR_W / 2, z0: -hd, z1: -hd + T_OUT }, { x0: doorU + DOOR_W / 2, x1: hw, z0: -hd, z1: -hd + T_OUT })
  outerUpC.push({ x0: -hw, x1: hw, z0: -hd, z1: -hd + T_OUT })
  for (const list of [outerC, outerUpC]) list.push({ x0: -hw, x1: hw, z0: hd - T_OUT, z1: hd }, { x0: -hw, x1: -hw + T_OUT, z0: -hd, z1: hd }, { x0: hw - T_OUT, x1: hw, z0: -hd, z1: hd })
  // Zwischenwände mit je einer Türlücke
  const seg = (a0: number, a1: number, line: number, alongZ: boolean, key: number, ca: number, cb: number) => {
    const span = a1 - a0, gc = a0 + 2.5 + hash(b, key, 1) * (span - 5)
    gapsC.push({ a: ca, b: cb, u: alongZ ? line : gc, v: alongZ ? gc : line })
    const piece = (p0: number, p1: number) => { if (p1 - p0 > 0.05) innerC.push(alongZ ? { x0: line - T_IN / 2, x1: line + T_IN / 2, z0: p0, z1: p1 } : { x0: p0, x1: p1, z0: line - T_IN / 2, z1: line + T_IN / 2 }) }
    piece(a0, gc - GAP_W / 2); piece(gc + GAP_W / 2, a1)
  }
  for (let i = 1; i < nx; i++) for (let j = 0; j < nz; j++) seg(-hd + j * cdep, -hd + (j + 1) * cdep, -hw + i * cwid, true, i * 31 + j, j * nx + i - 1, j * nx + i)
  for (let j = 1; j < nz; j++) for (let i = 0; i < nx; i++) seg(-hw + i * cwid, -hw + (i + 1) * cwid, -hd + j * cdep, false, 500 + j * 31 + i, (j - 1) * nx + i, j * nx + i)
  // Treppenhaus in der Zelle (0,0): zwei gegenläufige Läufe, durch eine Wand getrennt
  const v0 = -hd + T_OUT + 2.2, L = hall && so ? Math.min(cdep - T_OUT - 2.2 - 2.6, so.stair) : cdep - T_OUT - 2.2 - 2.6
  const laneA: Rect = { x0: -hw + 0.8, x1: -hw + 0.8 + STAIR_W, z0: v0, z1: v0 + L }
  const laneB: Rect = { x0: laneA.x1 + 0.4, x1: laneA.x1 + 0.4 + STAIR_W, z0: v0, z1: v0 + L }
  if (!hall) innerC.push({ x0: laneA.x1 + 0.1, x1: laneA.x1 + 0.3, z0: v0, z1: v0 + L })
  const floors = hall ? (so?.floors ?? 1) : Math.max(2, Math.floor(b.h / FLOOR_H))
  const flights: Flight[] = []
  // Steigrichtung kanonisch +v (gerade k) bzw. −v (ungerade k), in Weltrichtung gedreht
  const rotVec = (u: number, v: number) => (rot === 0 ? [u, v] : rot === 1 ? [v, -u] : rot === 2 ? [-u, -v] : [-v, u])
  for (let k = 0; k < floors - 1; k++) {
    const lane = toWorld(k % 2 === 0 ? laneA : laneB)
    const [dx, dz] = rotVec(0, k % 2 === 0 ? 1 : -1)
    const axisX = dx !== 0
    const dir = (axisX ? dx : dz) as 1 | -1
    flights.push({ k, lane, dir, lo: axisX ? lane.x0 : lane.z0, hi: axisX ? lane.x1 : lane.z1 })
  }
  const lay: Layout = {
    b, floors, fh,
    outerG: outerC.map(toWorld), outerUp: outerUpC.map(toWorld), inner: innerC.map(toWorld),
    door: { x: b.x + (rot === 0 ? doorU : rot === 1 ? -hd : rot === 2 ? -doorU : hd), z: b.z + (rot === 0 ? -hd : rot === 1 ? -doorU : rot === 2 ? hd : doorU), nx: rot === 1 ? -1 : rot === 3 ? 1 : 0, nz: rot === 0 ? -1 : rot === 2 ? 1 : 0 },
    flights,
    stairCell: toWorld({ x0: -hw, x1: -hw + cwid, z0: -hd, z1: -hd + cdep }),
    nx, nz, solids: specials.get(b) ?? [],
    gaps: gapsC.map((g) => { const p = rot === 0 ? [g.u, g.v] : rot === 1 ? [g.v, -g.u] : rot === 2 ? [-g.u, -g.v] : [-g.v, g.u]; return { a: g.a, b: g.b, x: b.x + p[0], z: b.z + p[1] } }),
    cellOf: (x, z) => {
      const dx = x - b.x, dz = z - b.z
      const [u, v] = rot === 0 ? [dx, dz] : rot === 1 ? [-dz, dx] : rot === 2 ? [-dx, -dz] : [dz, -dx]
      const i = Math.max(0, Math.min(nx - 1, Math.floor((u + hw) / cwid))), j = Math.max(0, Math.min(nz - 1, Math.floor((v + hd) / cdep)))
      return j * nx + i
    },
  }
  cache.set(b, lay)
  return lay
}

const inRect = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1

/** Wand-Kollision im Haus (Punkt gegen Rechtecke): Rückschub oder null, wenn der Punkt frei ist. Die Außenwand hat im Erdgeschoss die Türöffnung. */
export function interiorPush(b: Bld, x: number, z: number, y: number): { nx: number; nz: number; depth: number } | null {
  const lay = layoutOf(b)
  const outer = y < lay.fh - 0.3 ? lay.outerG : lay.outerUp
  let best: { nx: number; nz: number; depth: number } | null = null
  const test = (r: Rect) => {
    if (!inRect(r, x, z)) return
    const dl = x - r.x0, dr = r.x1 - x, dd = z - r.z0, du = r.z1 - z
    const m = Math.min(dl, dr, dd, du)
    const res = m === dl ? { nx: -1, nz: 0, depth: dl } : m === dr ? { nx: 1, nz: 0, depth: dr } : m === dd ? { nx: 0, nz: -1, depth: dd } : { nx: 0, nz: 1, depth: du }
    if (!best || res.depth > best.depth) best = res
  }
  // kaputte Bankscheibe: kein Widerstand
  if (!(b.kind === 'bank' && inGlassHole(x, z, y))) for (const r of outer) test(r)
  for (const r of lay.inner) test(r)
  for (const s of lay.solids) if (!s.deco && y < (s.y0 ?? 0) + s.h - 0.25 && y >= (s.y0 ?? 0) - 0.5) test(s)
  return best
}

/** Höhen der begehbaren Flächen im Haus bei (x, z): Deckenplatten (Treppenlöcher ausgespart), Treppenläufe, Dach. Leer, wenn (x, z) außerhalb ist. */
export function interiorSurfaces(b: Bld, x: number, z: number): number[] {
  const lay = layoutOf(b)
  const out: number[] = []
  for (let k = 0; k <= lay.floors; k++) {
    // Loch in Platte k über dem Lauf k−1 (der obere Teil, wo die Kopffreiheit fehlt)
    let hole = false
    if (k >= 1) {
      const f = lay.flights[k - 1]
      if (f && inRect(f.lane, x, z)) {
        const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
        const p = axisX ? x : z, t = (f.dir === 1 ? p - f.lo : f.hi - p) / (f.hi - f.lo)
        if (t > 0.38) hole = true
      }
    }
    if (!hole) out.push(k * lay.fh)
  }
  for (const f of lay.flights) {
    if (!inRect(f.lane, x, z)) continue
    const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
    const p = axisX ? x : z, t = (f.dir === 1 ? p - f.lo : f.hi - p) / (f.hi - f.lo)
    if (t >= 0 && t <= 1) out.push(f.k * lay.fh + t * lay.fh)
  }
  return out.sort((a, c) => a - c)
}

/** Nächster Wegpunkt innerhalb eines Geschosses: durch die Türlücken der Zimmerwände (Breitensuche über die Zellen). */
function roomStep(L: Layout, from: { x: number; z: number }, goal: { x: number; z: number }): { x: number; z: number } {
  const a = L.cellOf(from.x, from.z), g = L.cellOf(goal.x, goal.z)
  if (a === g) return goal
  const prev = new Map<number, { c: number; gx: number; gz: number }>([[a, { c: -1, gx: 0, gz: 0 }]])
  const q = [a]
  while (q.length && !prev.has(g)) {
    const c = q.shift()!
    for (const e of L.gaps) {
      const o = e.a === c ? e.b : e.b === c ? e.a : -1
      if (o >= 0 && !prev.has(o)) { prev.set(o, { c, gx: e.x, gz: e.z }); q.push(o) }
    }
  }
  if (!prev.has(g)) return goal
  let c = g, st = prev.get(g)!
  while (st.c !== a) { c = st.c; st = prev.get(c)! }
  return { x: st.gx, z: st.gz }
}

/** Weg innerhalb eines Hauses zu einem Punkt auf Geschoss ft (Treppen, Türlücken). */
function insideStep(L: Layout, from: { x: number; z: number; y: number }, to: { x: number; z: number }, ft: number): { x: number; z: number } {
  const fc = Math.max(0, Math.min(L.floors - 1, Math.floor((from.y + 0.3) / L.fh)))
  if (fc === ft) return roomStep(L, from, to)
  const up = ft > fc
  const f = L.flights[up ? fc : fc - 1]
  if (!f) return roomStep(L, from, to)
  const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
  const cx = (f.lane.x0 + f.lane.x1) / 2, cz = (f.lane.z0 + f.lane.z1) / 2, len = f.hi - f.lo
  const at = (t: number) => { const p = f.lo + (f.dir === 1 ? t : 1 - t) * len; return axisX ? { x: p, z: cz } : { x: cx, z: p } }
  const t = (axisX ? from.x - f.lo : from.z - f.lo) / len, tt = f.dir === 1 ? t : 1 - t
  const lane = axisX ? from.z >= f.lane.z0 && from.z <= f.lane.z1 : from.x >= f.lane.x0 && from.x <= f.lane.x1
  const inL = lane && tt > -0.3 && tt < 1.3
  if (up) return inL ? at(1.15) : roomStep(L, from, at(-0.12))
  return inL ? at(-0.15) : roomStep(L, from, at(1.12))
}

/** Nächster Wegpunkt für eine Figur (z. B. Polizist), die zu einem Ziel läuft – auch in Häuser hinein und die Treppen hinauf/hinunter. */
export function walkNav(from: { x: number; z: number; y: number }, to: { x: number; z: number; y?: number }): { x: number; z: number } {
  const bt = buildingAt(to.x, to.z), bw = buildingAt(from.x, from.z)
  const ty = to.y ?? 0
  if (bw && bw !== bt) {
    const L = layoutOf(bw), d = L.door
    if (Math.hypot(from.x - d.x, from.z - d.z) < 2.2 && from.y < 1) return { x: d.x + d.nx * 3, z: d.z + d.nz * 3 }
    return insideStep(L, from, { x: d.x - d.nx * 1.2, z: d.z - d.nz * 1.2 }, 0)
  }
  if (!bt) return { x: to.x, z: to.z }
  const L = layoutOf(bt), d = L.door
  if (bw !== bt) {
    const dOut = { x: d.x + d.nx * 3, z: d.z + d.nz * 3 }
    return Math.hypot(from.x - d.x, from.z - d.z) > 3.6 ? dOut : { x: d.x - d.nx * 2, z: d.z - d.nz * 2 }
  }
  const ft = Math.max(0, Math.min(L.floors - 1, Math.floor((ty + 0.3) / L.fh)))
  return insideStep(L, from, to, ft)
}
