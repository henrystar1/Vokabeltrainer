import { CITY, TUNNELS, bridgeAt, cityPush, tunnelAt, type TunnelSeg } from './city'
import { flyHeight } from '../stats'
import type { Car, Input } from './physics'

/** Polizeijagd in der offenen Stadt: Rollen, Autos, Fang-Regel und die Fahr-KI der Polizei-Bots. */
export type Role = 'bandit' | 'cop'

/** Autos der Rollen: Bandit schnell und fliegend, Polizei etwas langsamer (Admin-Fahrer: auch fliegend wie der Roadster). */
export function chaseCar(role: Role, isAdminCar: boolean, bot = false): { kind: string; color: string; top: number } {
  if (role === 'bandit') return { kind: 'roadster', color: '#111827', top: 255 }
  if (isAdminCar) return { kind: 'roadster', color: '#f8fafc', top: 215 }
  // Polizei fährt ebenfalls einen Flug-Wagen (sonst käme sie nicht an einen fliegenden Banditen)
  return { kind: 'roadster', color: '#f8fafc', top: bot ? 195 : 215 }
}

export const CATCH_DIST = 4.6
export const CHASE_MAX_MS = 6 * 60 * 1000

type Pos = { x: number; z: number; lvl?: number; fly?: number; y?: number }
/** Gefangen: Polizeiauto rammt den Bandit (gleiche Ebene, ähnliche Höhe, Auto an Auto). */
export function caught(cop: Pos, bandit: Pos): boolean {
  if ((cop.lvl ?? 0) !== (bandit.lvl ?? 0)) return false
  if (Math.hypot(cop.x - bandit.x, cop.z - bandit.z) > CATCH_DIST) return false
  const alt = (p: Pos) => (p.y !== undefined ? p.y : flyHeight(p.fly ?? 0))
  return Math.abs(alt(cop) - alt(bandit)) < 3
}

const wrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }
/** Freie Sicht zwischen zwei Punkten (keine Häuser dazwischen). */
export function clearLine(ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 4))
  for (let i = 1; i < n; i++) { const t = i / n; if (cityPush(ax + (bx - ax) * t, az + (bz - az) * t)) return false }
  return true
}

export interface BotMem { stuck: number; fix?: number; px?: number; pz?: number; pt?: number }
export interface BotDrive { inp: Input; reset?: { x: number; z: number; h: number }; repair?: boolean }
export const BOT_REPAIR_DMG = 55
export const BOT_REPAIR_SEC = 2

/** Die Röhre, in der das Auto gerade fährt (bei Kreuzungen die in Fahrtrichtung liegende). */
function segOf(car: Car): TunnelSeg | null {
  let best: TunnelSeg | null = null, bs = -1
  for (const t of TUNNELS) {
    const a = t.dir === 'x' ? car.x : car.z, p = t.dir === 'x' ? car.z : car.x
    if (a < t.a0 || a > t.a1 || Math.abs(p - t.c) > CITY.tw / 2) continue
    const al = Math.abs(t.dir === 'x' ? Math.sin(car.h) : Math.cos(car.h))
    if (al > bs) { bs = al; best = t }
  }
  return best
}
/** Ziel unter der Erde: zum Bandit abbiegen (Kreuzungen), sonst zum Ausgang in Fahrtrichtung. */
function tunnelWaypoint(car: Car, tgt: { x: number; z: number; lvl?: number }): { x: number; z: number } {
  const t = segOf(car)
  if (!t) return { x: tgt.x, z: tgt.z }
  const along = (x: number, z: number) => (t.dir === 'x' ? x : z), perp = (x: number, z: number) => (t.dir === 'x' ? z : x)
  const mk = (a: number, p: number) => (t.dir === 'x' ? { x: a, z: p } : { x: p, z: a })
  const fwd = (t.dir === 'x' ? Math.sin(car.h) : Math.cos(car.h)) >= 0 ? 1 : -1
  const ca = along(car.x, car.z), ta = along(tgt.x, tgt.z), tp = perp(tgt.x, tgt.z)
  // Zwischenziel nur ein Stück voraus auf der Mittellinie, damit der Bot sauber in der Röhrenmitte bleibt
  const lead = (a: number) => mk(ca + Math.sign(a - ca) * Math.min(28, Math.abs(a - ca)), t.c)
  const exit = lead(fwd > 0 ? t.a1 + 8 : t.a0 - 8)
  if ((tgt.lvl ?? 0) !== -1) return exit
  if (Math.abs(tp - t.c) < 8) return { x: tgt.x, z: tgt.z }  // Bandit in derselben Röhre
  // Querröhre, die in Richtung Bandit führt und dem Bandit längs am nächsten liegt
  let bj: TunnelSeg | null = null, bd = Infinity
  for (const o of TUNNELS) {
    if (o.dir === t.dir || o.c < t.a0 || o.c > t.a1 || t.c < o.a0 || t.c > o.a1) continue
    const room = Math.sign(tp - t.c) > 0 ? o.a1 - t.c : t.c - o.a0
    if (room < 30) continue
    const behind = (o.c - ca) * fwd < -12
    if (behind) continue
    const d = Math.abs(o.c - ta)
    if (d < bd) { bd = d; bj = o }
  }
  if (!bj) return exit
  if (Math.abs(bj.c - ca) < 9) return mk(bj.c, t.c + Math.sign(tp - t.c) * 60)  // in der Kreuzung: abbiegen
  return lead(bj.c)
}
/** Eingang zur Röhre, in der der Bandit unten fährt: die näheste Rampenmitte in der Straße. */
function entranceFor(car: Car, tgt: { x: number; z: number }): { x: number; z: number } | null {
  const t = tunnelAt(tgt.x, tgt.z)
  if (!t) return null
  const mk = (a: number, p: number) => (t.dir === 'x' ? { x: a, z: p } : { x: p, z: a })
  const ca = t.dir === 'x' ? car.x : car.z
  const e = Math.abs(ca - t.a0) < Math.abs(ca - t.a1) ? t.a0 + 30 : t.a1 - 30
  return mk(e, t.c)
}

/** Fahr-KI eines Polizei-Bots: fährt über die Straßen (und durch die Tunnel) auf `tgt` (den Bandit) zu, repariert sich selbst und löst sich, wenn er hängt. */
export function copDrive(car: Car, tgt0: { x: number; z: number; lvl?: number }, mem: BotMem, dt: number): BotDrive {
  const P = CITY.pitch, K = CITY.K
  const node = (v: number) => Math.max(-K, Math.min(K, Math.round(v / P)))
  const lvl = car.lvl ?? 0
  // Bandit unter der Erde und Bot oben: erst zum Eingang fahren
  const ent = lvl === 0 && (tgt0.lvl ?? 0) === -1 ? entranceFor(car, tgt0) : null
  // Außenbereich hinter dem Tor: nur durchs Tor (x = 0) erreichbar
  const HH = CITY.half, carOut = car.z > HH + 4, tgtOut = tgt0.z > HH + 4
  const gateTgt = carOut !== tgtOut ? (carOut ? { x: 0, z: HH - 40 } : { x: 0, z: HH + 40 }) : null
  const tgt = gateTgt ?? ent ?? tgt0
  const ci = node(car.x), cj = node(car.z), ti = node(tgt.x), tj = node(tgt.z)
  let wx = tgt.x, wz = tgt.z
  if (lvl === -1) {
    const w = tunnelWaypoint(car, tgt0); wx = w.x; wz = w.z
  } else if (lvl === 1) {
    const b = bridgeAt(car.x, car.z)
    if (b) { wx = Math.sin(car.h) >= 0 ? b.bx1 + 8 : b.bx0 - 8; wz = b.bz }
  } else if (carOut && !gateTgt) {
    wx = tgt.x; wz = tgt.z  // draußen frei fahren
  } else if (!(Math.hypot(tgt.x - car.x, tgt.z - car.z) < 70 && clearLine(car.x, car.z, tgt.x, tgt.z))) {
    const onCol = Math.abs(car.x - ci * P) < 11, onRow = Math.abs(car.z - cj * P) < 11
    const toward = (v: number, goal: number) => (goal > v ? Math.ceil((v + 0.5) / P) * P : Math.floor((v - 0.5) / P) * P)
    if (!onCol && !onRow) {
      // abseits der Straße: auf die nächste Straße zurück
      if (Math.abs(car.x - ci * P) < Math.abs(car.z - cj * P)) { wx = ci * P; wz = car.z } else { wx = car.x; wz = cj * P }
    } else if (onCol && onRow) {
      // Kreuzung: Richtung wählen
      if (Math.abs(ti - ci) >= Math.abs(tj - cj) && ti !== ci) { wx = (ci + Math.sign(ti - ci)) * P; wz = cj * P }
      else if (tj !== cj) { wx = ci * P; wz = (cj + Math.sign(tj - cj)) * P }
      else { wx = tgt.x; wz = tgt.z }
    } else if (onCol) {
      // auf einer Nord-Süd-Straße: bis zur nächsten Kreuzung in Richtung Ziel
      if (Math.abs(tgt.x - ci * P) < 11) { wx = tgt.x; wz = tgt.z } else { wx = ci * P; wz = toward(car.z, tgt.z) }
    } else {
      if (Math.abs(tgt.z - cj * P) < 11) { wx = tgt.x; wz = tgt.z } else { wx = toward(car.x, tgt.x); wz = cj * P }
    }
  }
  const diff = wrap(Math.atan2(wx - car.x, wz - car.z) - car.h)
  const dist = Math.hypot(wx - car.x, wz - car.z)
  const sharp = Math.abs(diff) > 0.55
  // vor Kreuzungen (Zwischenziel) runter auf Abbiege-Tempo, sonst fliegt der Bot aus der Kurve
  const nodeWp = lvl === 0 && !(wx === tgt.x && wz === tgt.z)
  let exitBrake = false
  if (lvl === -1 && (tgt0.lvl ?? 0) !== -1) {
    const sg = segOf(car)
    if (sg) { const ca = sg.dir === 'x' ? car.x : car.z, f = (sg.dir === 'x' ? Math.sin(car.h) : Math.cos(car.h)) >= 0; exitBrake = (f ? sg.a1 - ca : ca - sg.a0) < 110 && car.v > 24 }
  }
  const slow = (nodeWp && dist < 55 && car.v > 21) || exitBrake
  const brake = car.v > 9 && (Math.abs(diff) > 1.0 || (sharp && dist < 38 && car.v > 15) || (nodeWp && dist < 45 && car.v > 26) || (exitBrake && car.v > 28))
  const inp: Input = { gas: !brake && !slow && (Math.abs(diff) < 1.3 || car.v < 6), brake, left: diff > 0.07, right: diff < -0.07 }
  // Selbstreparatur: bei Schaden kurz stehen bleiben, dann ist das Auto wieder heil
  if ((mem.fix ?? 0) > 0) {
    mem.fix = (mem.fix ?? 0) - dt
    if ((mem.fix ?? 0) <= 0) { mem.fix = 0; mem.stuck = 0; mem.pt = 0; return { inp: { gas: false, brake: false, left: false, right: false }, repair: true } }
    return { inp: { gas: false, brake: true, left: false, right: false } }
  }
  if (car.dmg >= BOT_REPAIR_DMG) { mem.fix = BOT_REPAIR_SEC; return { inp: { gas: false, brake: true, left: false, right: false } } }
  // hängt er? (kaum Fahrt oder in 2 s kaum von der Stelle gekommen, obwohl das Ziel weit weg ist)
  mem.stuck = Math.abs(car.v) < 1.5 ? mem.stuck + dt : 0
  mem.pt = (mem.pt ?? 0) + dt
  let far = false
  if (mem.pt >= 2) {
    far = mem.px !== undefined && mem.pz !== undefined && Math.hypot(car.x - mem.px, car.z - mem.pz) < 6 && dist > 14
    mem.px = car.x; mem.pz = car.z; mem.pt = 0
  } else if (mem.px === undefined) { mem.px = car.x; mem.pz = car.z }
  if (mem.stuck > 1.6 || far) {
    mem.stuck = 0
    // neu auf die nächste Kreuzung setzen, Blick zum Ziel entlang der Straße
    const alongX = Math.abs(tgt.x - ci * P) > Math.abs(tgt.z - cj * P)
    const h = alongX ? (tgt.x >= ci * P ? Math.PI / 2 : -Math.PI / 2) : (tgt.z >= cj * P ? 0 : Math.PI)
    return { inp, reset: { x: ci * P, z: cj * P, h } }
  }
  return { inp }
}

/** Startpunkt für Polizei-Bot Nr. i: Kreuzungen in der Stadtmitte. */
export function copSpawn(i: number): { x: number; z: number; h: number } {
  const P = CITY.pitch
  const ring = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [0, 2], [-2, 0], [2, 0]][i % 8]
  return { x: ring[0] * P, z: ring[1] * P, h: 0 }
}
