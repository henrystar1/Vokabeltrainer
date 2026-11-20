import { PARK, PARK_LANES, PARK_TOP, inParkXZ } from './parkhaus'
import { RING_CORNERS, GATE } from './mountains'
import { CITY, GARAGES, TUNNELS, bridgeAt, cityPush, type TunnelSeg } from './city'
import { flyHeight } from '../stats'
import type { Car, Input } from './physics'

/** Polizeijagd in der offenen Stadt: Rollen, Autos, Fang-Regel und die Fahr-KI der Polizei-Bots. */
export type Role = 'bandit' | 'cop'

/** Autos der Rollen: Bandit schnell und fliegend, Polizei etwas langsamer (Admin-Fahrer: auch fliegend wie der Roadster). */
export function chaseCar(role: Role, isAdminCar: boolean, bot = false, onBike = false): { kind: string; color: string; top: number } {
  // Wer mit einem Motorrad in die Stadt kommt, fährt auch die Jagd auf einem Motorrad (Bandit dunkel, Polizei weiß)
  if (onBike) return { kind: 'sportbike', color: role === 'bandit' ? '#111827' : '#f8fafc', top: role === 'bandit' ? 240 : 225 }
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
function tunnelWaypoint(car: Car, tgt: { x: number; z: number; lvl?: number }): { x: number; z: number; cross?: number } {
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
  return { ...lead(bj.c), cross: Math.abs(bj.c - ca) }
}
/** Garage, über die man am besten zu `to` kommt (Einfahrt nah am Auto, Ausfahrt nah am Ziel). */
function bestGarage(from: { x: number; z: number }, to: { x: number; z: number }, inward: boolean): (typeof GARAGES)[number] {
  let best = GARAGES[0], bd = Infinity
  for (const g of GARAGES) {
    const d = inward ? Math.hypot(g.out.x - from.x, g.out.z - from.z) + Math.hypot(g.inn.x - to.x, g.inn.z - to.z) : Math.hypot(g.inn.x - from.x, g.inn.z - from.z) + Math.hypot(g.out.x - to.x, g.out.z - to.z)
    if (d < bd) { bd = d; best = g }
  }
  return best
}
/** Eingang zum Tunnelnetz: die nächste Garage – erst zur Straße vor dem Tor, dann (ab 45 m) direkt hinein. */
function entranceFor(car: Car, tgt: { x: number; z: number }): { x: number; z: number; direct?: boolean } {
  const g = bestGarage(car, tgt, true)
  // schon in der Einfahrt (zwischen Straße und Garage, auf der Achse) oder an der Straße vor dem Tor: geradeaus hinein
  const ax = g.inn.x - g.out.x, az = g.inn.z - g.out.z, al = Math.hypot(ax, az)
  const rx = car.x - g.out.x, rz = car.z - g.out.z
  const t = (rx * ax + rz * az) / (al * al), off = Math.abs(rx * az - rz * ax) / al
  if (Math.hypot(rx, rz) < 8 || (t > 0 && t < 1.4 && off < 8)) return { ...g.inn, direct: true }
  return { ...g.out }
}

/**
 * Fahr-KI im Parkhaus: rauf im Zick-Zack (Rampe auf der Westspur nach Norden, oben auf der Ostspur zurück nach Süden, am Südende wieder auf die Rampe),
 * runter spiegelbildlich. `direct`: geradeaus zum Ziel (gleiche Ebene) bzw. in die Einfahrt hinein; sonst Straßenpunkt vor dem Tor.
 */
export function parkNav(car: Car, tgt: { x: number; z: number; y?: number }): { x: number; z: number; direct?: boolean; slow?: boolean; hold?: boolean } | null {
  const { x0, x1, z0, ramp, up: upW, dn: dnW } = PARK
  const xU = PARK_LANES.up, xD = PARK_LANES.dn, xC = PARK_LANES.east, xB = PARK_LANES.mid, xm = x0 + upW + dnW
  const carIn = inParkXZ(car.x, car.z, 1), tIn = inParkXZ(tgt.x, tgt.z, 2)
  if (!carIn && !tIn) return null
  const y = car.y ?? 0, ty = tgt.y ?? 0, s = car.z - z0
  const lev = (h: number) => Math.floor((h + PARK.floorH / 2) / PARK.floorH + 1e-9)
  const Lc = lev(y), Lt = lev(ty)
  const go = (x: number, z: number) => ({ x, z, direct: true, slow: true })
  if (!carIn) {
    // von außen: Ziel im Erdgeschoss oder darunter → über die Einfahrt (unten über die Abfahrt); sonst hochfliegen und von oben weiter
    if (ty < 2.5) {
      const ex = ty < -2 ? xD : xB
      const out = { x: ex, z: z0 - 16 }, rx = car.x - out.x, rz = car.z - out.z
      if (Math.hypot(rx, rz) < 8 || (car.z < z0 && car.z > z0 - 30 && Math.abs(rx) < 9)) return go(ex, z0 + 12)
      return { x: out.x, z: -240 }
    }
    const fx = Math.max(PARK.x0, Math.min(PARK.x1, car.x)), fz = Math.max(PARK.z0, Math.min(PARK.z1, car.z))
    if (Math.hypot(car.x - fx, car.z - fz) < 45) return y < PARK_TOP + 2.5 ? { x: car.x, z: car.z, hold: true } : { x: tgt.x, z: tgt.z, direct: true, slow: true }
    return { x: xU, z: -240 }
  }
  // auf einer Rampe (nicht darunter): Position im Schacht UND Höhe passt zur Rampenfläche
  const fl = PARK.floorH * Math.min(s, ramp) / ramp
  const inUp = car.x < x0 + upW && s < ramp && y > -2
  const inDn = car.x >= x0 + upW && car.x < xm && s < ramp && Math.abs(y + fl) < 2.2
  const inEast = car.x >= x1 - PARK.east && s < ramp && Math.abs(y - (-2 * PARK.floorH + fl)) < 2.2
  // Ziel auf gleicher Ebene (nicht in einem Schacht): geradeaus
  const tShaft = tIn && tgt.x < xm && tgt.z - z0 < ramp
  if (tIn && Lc === Lt && !inUp && !inDn && !inEast && !tShaft) return go(tgt.x, tgt.z)
  const wantLevel = tIn ? Lt : 0                                   // Ziel draußen: Straße = Ebene 0
  // Abfahrt ins 1. Untergeschoss (neben der Rampe hinauf): von der Einfahrt nach Norden hinunter, in der Gegenrichtung hinauf
  if (inDn) {
    if (wantLevel < 0) return go(xD, z0 + ramp + 24)
    if (Lc >= 0 && tIn) return go(xB, z0 + 4)                      // oben angekommen: auf die Mittelspur
    return go(xD, z0 - 30)
  }
  // Abfahrt ins 2. Untergeschoss (Osten): nach Norden hinauf, nach Süden hinunter
  if (inEast) {
    if (wantLevel <= -2) return Lc <= -2 && tIn ? go(tgt.x, tgt.z) : go(xC, z0 + 9)
    return go(xC, z0 + ramp + 24)
  }
  if (Lc < 0) {
    if (wantLevel < Lc) return car.x > xC - 4 ? go(xC, z0 + 9) : go(xC, z0 + ramp + 24)    // runter: Ostspur, dann nach Süden
    if (Lc === -2) return go(xC, z0 + 9)                                                    // 2. UG: zum Südende der Ostrampe, dann nach Norden (inEast)
    return Math.abs(car.x - xD) < 6 ? go(xD, z0 - 30) : go(xD, z0 + ramp + 24)             // 1. UG: zur Abfahrt, nach Süden hinauf
  }
  if (Lc === 0 && wantLevel < 0) return s > 14 && !inUp ? go(xB, z0 + 6) : go(xD, z0 + 3)  // Erdgeschoss → Abfahrt nach unten
  if (Lc === 0 && !tIn) return go(car.x, z0 - 30)                                           // Ziel draußen: nach Süden hinaus
  if (tIn && wantLevel > Lc) {
    if (inUp) return go(xU, z0 + ramp + 14)                                                 // Rampe hinauf
    if (car.x < x0 + upW + 1) return go(xB, z0 + ramp + 8)                                  // oben angekommen: auf die Mittelspur
    if (s > 12) return go(xB, z0 + 6)                                                       // Mittelspur nach Süden
    return go(xU, z0 + 6)                                                                   // am Südende: nach Westen auf die Rampenspur
  }
  // oben, runter (Rampe hinab)
  if (inUp) return s > 9 ? go(xU, z0 + 2) : go(xB, z0 + 5)
  if (car.x < x0 + upW + 1) return go(xU, z0 + ramp - 14)
  return s < ramp + 4 ? go(xB, z0 + ramp + 8) : go(xU, z0 + ramp + 6)
}

/** Schneidet die Strecke a→b die Stadtmauer (Quadrat)? */
function wallBlocks(ax: number, az: number, bx: number, bz: number): boolean {
  const H = CITY.half + 3
  for (let i = 1; i < 40; i++) { const t = i / 40, x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (Math.abs(x) < H && Math.abs(z) < H) return true }
  return false
}

/** Weglänge von (x, z) zum Ziel um die Stadtmauer herum (über die Ecken der Rennstrecke; `seen` = Bitmaske besuchter Ecken). */
function routeLen(x: number, z: number, t: { x: number; z: number }, seen: number): number {
  if (!wallBlocks(x, z, t.x, t.z)) return Math.hypot(t.x - x, t.z - z)
  let b = Infinity
  RING_CORNERS.forEach(([cx, cz], k) => {
    if (seen & (1 << k) || wallBlocks(x, z, cx, cz)) return
    b = Math.min(b, Math.hypot(cx - x, cz - z) + routeLen(cx, cz, t, seen | (1 << k)))
  })
  return b
}

/** Fahr-KI eines Polizei-Bots: fährt über die Straßen (und durch die Tunnel) auf `tgt` (den Bandit) zu, repariert sich selbst und löst sich, wenn er hängt. */
export function copDrive(car: Car, tgt0: { x: number; z: number; lvl?: number; y?: number }, mem: BotMem, dt: number): BotDrive {
  const P = CITY.pitch, K = CITY.K
  const node = (v: number) => Math.max(-K, Math.min(K, Math.round(v / P)))
  const lvl = car.lvl ?? 0
  // Bandit unter der Erde und Bot oben: erst zum Eingang fahren
  const pk = lvl === 0 && (tgt0.lvl ?? 0) !== -1 ? parkNav(car, tgt0 as { x: number; z: number; y?: number }) : null
  const ent = lvl === 0 && (tgt0.lvl ?? 0) === -1 ? entranceFor(car, tgt0) : pk
  // Außenwelt (Rennstrecke, Wiesen, Berge): in die Stadt nur durchs Nordtor (x = 0); um die Mauer herum über die Ecken der Rennstrecke
  const HH = CITY.half
  const isOut = (x: number, z: number) => Math.abs(x) > HH + 4 || Math.abs(z) > HH + 4
  const carOut = isOut(car.x, car.z), tgtOut = isOut(tgt0.x, tgt0.z)
  const aroundWall = (t: { x: number; z: number }) => {
    if (!wallBlocks(car.x, car.z, t.x, t.z)) return t
    let best: { x: number; z: number } | null = null, bd = Infinity
    RING_CORNERS.forEach(([cx, cz], k) => {
      if (wallBlocks(car.x, car.z, cx, cz)) return
      const sc = Math.hypot(cx - car.x, cz - car.z) + routeLen(cx, cz, t, 1 << k)
      if (sc < bd) { bd = sc; best = { x: cx, z: cz } }
    })
    return best ?? t
  }
  let gateTgt: { x: number; z: number } | null = null
  if (carOut && !tgtOut) gateTgt = car.z > HH && Math.abs(car.x) < GATE + 14 ? { x: 0, z: HH - 40 } : aroundWall({ x: 0, z: HH + 40 })
  else if (!carOut && tgtOut) gateTgt = { x: 0, z: HH + 40 }
  else if (carOut && tgtOut) { const w = aroundWall(tgt0); gateTgt = w === tgt0 ? null : w }
  const cornerWp = !!gateTgt && RING_CORNERS.some(([cx, cz]) => cx === gateTgt!.x && cz === gateTgt!.z)
  const tgt = gateTgt ?? ent ?? tgt0
  const entDirect = !gateTgt && !!ent && (ent as { direct?: boolean }).direct
  const ci = node(car.x), cj = node(car.z), ti = node(tgt.x), tj = node(tgt.z)
  let wx = tgt.x, wz = tgt.z, cross: number | undefined
  if (lvl === -1) {
    // Bandit oben: unten zur Ausfahrt der besten Garage (Röhrenmitte vor dem Tor)
    const up = (tgt0.lvl ?? 0) !== -1
    const gx = up ? bestGarage(car, tgt0, false) : null
    const w = tunnelWaypoint(car, gx ? { x: gx.out.x, z: gx.out.z, lvl: -1 } : tgt0); wx = w.x; wz = w.z; cross = w.cross
  } else if (lvl === 1) {
    const b = bridgeAt(car.x, car.z)
    if (b) { wx = Math.sin(car.h) >= 0 ? b.bx1 + 8 : b.bx0 - 8; wz = b.bz }
  } else if (entDirect) {
    wx = tgt.x; wz = tgt.z
  } else if (carOut) {
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
  // Garagen-Zufahrt: vor dem Tor auf Schritttempo, damit er die Kurve in die Einfahrt schafft
  const gApproach = lvl === 0 && !gateTgt && !!ent && !entDirect
  const parkSlow = !!pk?.slow
  if (pk?.hold) { mem.stuck = 0; mem.pt = 0; return { inp: { gas: false, brake: true, left: false, right: false } } }
  const slow = (cornerWp && dist < 150 && car.v > 17) || (nodeWp && dist < 55 && car.v > 21) || exitBrake || (parkSlow && car.v > 11) || (gApproach && dist < 60 && car.v > 12) || (cross !== undefined && cross < 90 && car.v > 17)
  const brake = car.v > 9 && ((cornerWp && dist < 120 && car.v > 24) || (parkSlow && car.v > 15) || (gApproach && dist < 40 && car.v > 9) || (cross !== undefined && cross < 60 && car.v > 20) || Math.abs(diff) > 1.0 || (sharp && dist < 38 && car.v > 15) || (nodeWp && dist < 45 && car.v > 26) || (exitBrake && car.v > 28))
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
