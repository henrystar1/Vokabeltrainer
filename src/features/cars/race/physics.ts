import { advance, inPolygon, pointAt, project, type Track } from './track'
import { canFly, carKmh, flyConfig, flyHeight, isBike, kindDims, kindStats } from '../stats'
import { CITY, bridgeAt, bridgeH, cityPush, onDeck } from './city'
import { G, STUNT, arenaPush, groundH, loopPoint } from './stunt'
import { upFactors, type Up } from '../tuning'
import { boxHit, corners, impactDamage, type Box } from './collide'
import { botSteer, type RaceLine } from './line'

/** Fahrwerte eines Autos: Höchstgeschwindigkeit (m/s), Beschleunigung, Lenkung, Bremse. */
export interface CarStats { top: number; acc: number; turn: number; brake: number; len: number; wid: number; fly: boolean; bike: boolean }
/** Werte je Art; mit `kmh` (eigener Höchstwert des Autos) wird Tempo und Beschleunigung entsprechend skaliert. */
export const statsFor = (kind: string, kmh?: number | null, up?: Up | null): CarStats => {
  const k = kindStats(kind)
  const f = carKmh(kind, kmh) / k.kmh
  const d = kindDims(kind)
  const u = up ? upFactors(up) : { top: 1, acc: 1, turn: 1, brake: 1 }
  return { top: (k.kmh * f * u.top) / 3.6, acc: k.acc * Math.pow(f, 0.8) * u.acc, turn: k.turn * u.turn, brake: k.brake * Math.pow(f, 0.5) * u.brake, len: d.len, wid: d.wid, fly: canFly(kind), bike: isBike(kind) }
}
export const STATS: Record<string, CarStats> = Object.fromEntries(['kleinwagen', 'limousine', 'kombi', 'suv', 'pickup', 'cabrio', 'sportwagen', 'bus', 'oldtimer', 'buggy', 'monstertruck', 'muscle', 'rallye', 'gt', 'hypercar', 'rennwagen'].map((k) => [k, statsFor(k)]))

export interface Input { gas: boolean; brake: boolean; left: boolean; right: boolean; /** Flug starten (nur Roadster) */ fly?: boolean; /** Auto-Drift des Fahrassistenten: driftet ohne Bremsen und ohne Tempoverlust */ drift?: boolean; /** Gewünschte Drehrate der Fahrtrichtung (rad/s) beim Auto-Drift */ turn?: number }
export interface Car {
  x: number; z: number
  /** Fahrtrichtung in Bogenmaß: 0 = nach +z, wächst gegen den Uhrzeigersinn von oben (dx = sin h, dz = cos h) */
  h: number
  v: number
  steer: number
  /** zurückgelegte Strecke inkl. Runden (m) */
  total: number
  idx: number
  lap: number
  offroad: boolean
  /** Wandkontakt in diesem Schritt (für Ton/Wackeln) */
  bump: number
  /** Driftwinkel (Bogenmaß): Unterschied zwischen Blickrichtung und Fahrtrichtung */
  slip: number
  /** Schaden 0–100 (100 = Totalschaden) */
  dmg: number
  /** Richtung, in die ein beschädigtes Auto zieht (+1/−1) */
  pull: number
  /** Wartezeit in der Werkstatt nach dem Zurücksetzen (s) */
  hold: number
  /** Aufprallstärke in diesem Schritt (0–1, für Schütteln und Funken) */
  hit: number
  /** Restzeit des Flugs (s), 0 = am Boden */
  fly: number
  /** 1 = auf der Brücke (nur Stadt) */
  lvl?: number
  /** Stunt-Park: Höhe, Steiggeschwindigkeit, Loopwinkel (0 = nicht im Looping) und Einfahrdaten */
  y?: number
  vy?: number
  loop?: number
  lp?: { x: number; z: number; h: number; lat: number; v0: number }
  /** Wartezeit bis zum nächsten Flug (s) */
  cool: number
}

export const CAR_R = 2.2

export function startCar(t: Track, slot: number): Car {
  // Aufstellung: Zweierreihen hinter der Startlinie
  const row = Math.floor(slot / 2), col = slot % 2
  if (t.def.mode === 'stunt') return { x: (col ? 5 : -5) - 150, z: -280 - row * 10, h: 0, v: 0, steer: 0, total: 0, idx: 0, lap: 0, offroad: false, bump: 0, slip: 0, dmg: 0, pull: 1, hold: 0, hit: 0, fly: 0, cool: 0 }
  if (t.def.mode === 'city') return { x: (col ? 5 : -5), z: -row * 10, h: 0, v: 0, steer: 0, total: 0, idx: 0, lap: 0, offroad: false, bump: 0, slip: 0, dmg: 0, pull: 1, hold: 0, hit: 0, fly: 0, cool: 0, lvl: 0 }
  if (t.def.mode === 'fill') {
    const P = t.def.pts, n = P.length
    const cx = P.reduce((a, q) => a + q[0], 0) / n, cz = P.reduce((a, q) => a + q[1], 0) / n
    return { x: cx + (col ? 6 : -6), z: cz - row * 9, h: 0, v: 0, steer: 0, total: 0, idx: 0, lap: 0, offroad: false, bump: 0, slip: 0, dmg: 0, pull: 1, hold: 0, hit: 0, fly: 0, cool: 0 }
  }
  const p = pointAt(t, t.length - 10 - row * 9, (col ? 1 : -1) * t.def.width * 0.22)
  return { x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), v: 0, steer: 0, total: -(10 + row * 9), idx: p.i, lap: 0, offroad: false, bump: 0, slip: 0, dmg: 0, pull: 1, hold: 0, hit: 0, fly: 0, cool: 0 }
}

export const DMG_MAX = 100
/** Größte Seitenbeschleunigung beim Auto-Drift (m/s²) */
export const AUTO_LAT = 110
const wrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }

/** Hitbox eines Autos. */
export const boxOf = (c: { x: number; z: number; h: number }, st: { len: number; wid: number }): Box => ({ x: c.x, z: c.z, h: c.h, l: st.len, w: st.wid })

/** Schaden dazurechnen (mit Obergrenze `cap`) und die Zugrichtung festlegen. */
export function addDamage(c: Car, amount: number, cap = DMG_MAX): Car {
  if (amount <= 0) return c
  return { ...c, dmg: Math.min(cap, c.dmg + amount), pull: c.dmg === 0 ? (Math.random() < 0.5 ? -1 : 1) : c.pull }
}

/** Ein Zeitschritt. Arcade-Fahrverhalten: Lenkung hängt vom Tempo ab, Gras bremst, Leitplanken (mit Hitbox) fangen ab und beschädigen.
 *  Driften: Bremse + Lenken bei Tempo schiebt das Heck raus (`drift` = erlaubt). */
export function stepCar(c: Car, inp: Input, dt: number, t: Track, st: CarStats, canDrive = true, drift = true): Car {
  if (t.def.mode === 'stunt' && (c.loop ?? 0) > 0 && c.lp) return loopStep(c, dt)
  const d = c.dmg / DMG_MAX
  const wrecked = c.dmg >= DMG_MAX
  const waiting = c.hold > 0
  let fly = c.fly, cool = c.cool
  if (fly <= 0 && cool > 0) cool = Math.max(0, cool - dt)
  if (st.fly && inp.fly && canDrive && !wrecked && !waiting && fly <= 0 && cool <= 0) fly = flyConfig.sec
  const flying = fly > 0
  if (flying) { fly = Math.max(0, fly - dt); if (fly === 0) cool = flyConfig.cool }
  const can = canDrive && !wrecked && !waiting
  const gas = can && inp.gas, brake = canDrive && inp.brake && !waiting
  let v = c.v
  const fill = t.def.mode === 'fill'
  const city = t.def.mode === 'city'
  const stunt = t.def.mode === 'stunt'
  const free = t.def.mode === 'free' || fill || city || stunt, disc = t.def.mode === 'disc'
  const pr = free ? { i: c.idx, s: 0, lat: 0, dist: fill && !inPolygon(t.def.pts, c.x, c.z) ? t.def.width : 0 } : project(t, c.x, c.z, c.idx)
  const half = free || disc ? t.def.width / 2 : t.hw[pr.i]
  const off = pr.dist > half
  // Schotterfeld: außen in manchen Kurven – deutlich langsamer, aber ohne Schaden
  const gravel = off && !free && !disc && t.gr[pr.i] > 0 && Math.sign(pr.lat) === t.gs[pr.i]
  const top = st.top * (off && !flying ? (gravel ? 0.36 : 0.5) : 1) * (wrecked ? 0.12 : 1 - 0.5 * d)
  const acc = st.acc * (1 - 0.55 * d)
  const target = (inp.right ? -1 : 0) + (inp.left ? 1 : 0)
  const auto = !!inp.drift
  const drifting = drift && can && (auto ? v > 14 : brake && target !== 0 && v > 14)
  if (gas) v += acc * (1 - Math.max(0, v) / (st.top * 1.08)) * dt
  if (brake) v -= (v > 0 ? st.brake * (drifting && !auto ? 0.3 : 1) : st.acc * 0.6) * dt
  if (!gas && !brake && !flying) v -= Math.sign(v) * Math.min(Math.abs(v), (4 + v * v * 0.004 + (wrecked ? 10 : 0)) * dt)
  if (waiting) v -= Math.sign(v) * Math.min(Math.abs(v), 40 * dt)
  if (v > top) v -= (v - top) * Math.min(1, 2.4 * dt)
  if (gravel && !flying) v -= v * Math.min(1, 0.5 * dt)
  v = Math.max(-10, v)
  // Lenkung läuft sanft auf den Zielwert (weniger Zappeln mit Tasten)
  const steer = c.steer + (target - c.steer) * Math.min(1, 7 * dt)
  const grip = Math.min(1, Math.abs(v) / 9)
  const speedFactor = 1 / (1 + Math.abs(v) * 0.022)
  // Driftwinkel: baut sich beim Driften auf, sonst bekommen die Reifen wieder Halt
  const slipTarget = drifting ? (auto ? Math.max(-0.62, Math.min(0.62, (inp.turn ?? 0) * 0.24)) : Math.sign(target) * Math.min(0.7, 0.22 + v / 140)) : 0
  const slip = c.slip + (slipTarget - c.slip) * Math.min(1, (drifting ? 3.2 : 2.4) * dt)
  const autoDrift = auto && drifting
  let h = c.h + steer * st.turn * grip * speedFactor * Math.sign(v || 1) * dt * 1.35 * (1 + Math.abs(slip) * (auto ? 3.4 : 0.9))
  // Auto-Drift (Fahrassistent): die Fahrtrichtung folgt direkt der Wunschdrehung, das Heck steht quer dazu
  if (autoDrift) {
    const maxRate = AUTO_LAT / Math.max(Math.abs(v), 8)
    const rate = Math.max(-maxRate, Math.min(maxRate, inp.turn ?? 0))
    h = c.h - c.slip + rate * dt + slip
  }
  // beschädigtes Auto zieht zur Seite
  if (d > 0.3) h += c.pull * (d - 0.3) * 0.5 * Math.min(1, Math.abs(v) / 25) * dt
  // Seitenrutschen in schnellen Kurven und beim Driften: Tempo geht verloren
  v -= Math.abs(steer) * Math.abs(v) * 0.16 * dt * (Math.abs(v) / st.top) * (auto ? 0.3 : 1)
  v -= Math.abs(slip) * Math.abs(v) * 0.22 * dt * (auto ? 0.25 : 1)
  const moveH = h - slip
  let x = c.x + Math.sin(moveH) * v * dt
  let z = c.z + Math.cos(moveH) * v * dt
  let bump = 0
  let hit = 0
  let dmg = c.dmg
  // Leitplanke: die Ecken der Karosserie zählen, nicht nur die Mitte
  const pr2 = free ? pr : project(t, x, z, pr.i)
  let worst = 0, wi = pr2.i, wl = pr2.lat
  if (!free && !disc) for (const [cx, cz] of corners({ x, z, h, l: st.len, w: st.wid })) {
    const q = project(t, cx, cz, pr2.i)
    const wall = t.hw[q.i] + 4.5 + (t.gs[q.i] === Math.sign(q.lat) ? t.gr[q.i] : 0)
    if (q.dist - wall > worst) { worst = q.dist - wall; wi = q.i; wl = q.lat }
  }
  if (worst > 0 && flying) {
    // im Flug: nur zurück auf die Strecke schieben, kein Schaden
    const nx = -t.tz[wi] * Math.sign(wl || 1), nz = t.tx[wi] * Math.sign(wl || 1)
    x -= nx * worst; z -= nz * worst
  } else if (worst > 0) {
    const nx = -t.tz[wi] * Math.sign(wl || 1), nz = t.tx[wi] * Math.sign(wl || 1)
    x -= nx * worst; z -= nz * worst
    const tang = Math.atan2(t.tx[wi], t.tz[wi])
    const dd = wrap(tang - h)
    // Aufprall: Anteil der Geschwindigkeit quer zur Wand
    const vn = Math.abs(v) * Math.abs(Math.sin(dd)) + Math.min(6, worst * 4)
    dmg = Math.min(DMG_MAX, dmg + impactDamage(vn))
    h += dd * Math.min(1, 3 * dt)
    bump = Math.min(1, Math.abs(v) / 30)
    hit = Math.min(1, vn / 25)
    v *= 1 - Math.min(0.9, (2.2 + vn * 0.04) * dt)
  }
  let lvl = c.lvl ?? 0
  if (city) {
    // Brücke: Rampe hinauf (längs fahren) oder im Flug von der Seite landen; oben Geländer
    if (lvl === 0) {
      if (onDeck(x, z)) {
        const H = bridgeH(x, z)
        if (flying ? flyHeight(fly) <= H + 0.2 && H > 1.5 : H < 1.5 && Math.abs(Math.sin(moveH)) > 0.75 && Math.abs(v) > 3) lvl = 1
      }
    } else if (!onDeck(x, z)) lvl = 0
    const br = lvl === 1 ? bridgeAt(x, z) : null
    if (br && bridgeH(x, z) > 1.5) {
      const dz = z - br.bz, lim = CITY.bw - 0.8
      if (Math.abs(dz) > lim) {
        z = br.bz + Math.sign(dz) * lim
        const vn = Math.abs(v) * Math.abs(Math.cos(moveH))
        dmg = Math.min(DMG_MAX, dmg + impactDamage(vn))
        v *= 1 - Math.min(0.9, (2.2 + vn * 0.04) * dt); bump = Math.max(bump, Math.min(1, Math.abs(v) / 30)); hit = Math.max(hit, Math.min(1, vn / 25))
      }
    }
    // Häuser und Stadtmauer (auf der Brücke fährt man darüber)
    if (lvl === 0) {
      let bd = 0, bnx = 0, bnz = 0
      for (const [cx, cz] of corners({ x, z, h, l: st.len, w: st.wid })) {
        const p = cityPush(cx, cz)
        if (p && p.depth > bd) { bd = p.depth; bnx = p.nx; bnz = p.nz }
      }
      if (bd > 0) {
        x += bnx * bd; z += bnz * bd
        const vn = Math.max(0, -(Math.sin(moveH) * bnx + Math.cos(moveH) * bnz) * v)
        dmg = Math.min(DMG_MAX, dmg + impactDamage(vn + Math.min(6, bd * 4)))
        v *= 1 - Math.min(0.9, (2.2 + vn * 0.04) * dt)
        bump = Math.max(bump, Math.min(1, Math.abs(v) / 30)); hit = Math.max(hit, Math.min(1, vn / 25))
      }
    }
  }
  let y = c.y ?? 0, vy = c.vy ?? 0, loop = 0
  let lp: Car['lp']
  if (stunt) {
    // Arenagrenze
    const ap = arenaPush(x, z)
    if (ap) {
      x += ap.nx * ap.depth; z += ap.nz * ap.depth
      const vn = Math.max(0, -(Math.sin(moveH) * ap.nx + Math.cos(moveH) * ap.nz) * v)
      dmg = Math.min(DMG_MAX, dmg + impactDamage(vn + Math.min(6, ap.depth * 4)))
      v *= 1 - Math.min(0.9, (2.2 + vn * 0.04) * dt); bump = Math.max(bump, Math.min(1, Math.abs(v) / 30)); hit = Math.max(hit, Math.min(1, vn / 25))
    }
    // Rampen, Hügel und Sprünge: am Boden der Rampe folgen, sonst fliegen (Wurfparabel)
    const gH = groundH(x, z), gPrev = groundH(c.x, c.z)
    if (y > gPrev + 0.05) {
      vy -= G * dt; y += vy * dt
      if (y <= gH) {
        dmg = Math.min(DMG_MAX, dmg + impactDamage(-vy * 0.7)); v *= 0.98
        bump = Math.max(bump, Math.min(1, -vy / 15)); y = gH; vy = 0
      }
    } else {
      const ball = y + vy * dt - 0.5 * G * dt * dt
      if (vy > 0.5 && gH < ball - 0.05) { vy -= G * dt; y = ball }
      else { vy = Math.max(-25, Math.min(25, (gH - y) / dt)); y = gH }
    }
    // Looping: ab 100 km/h am Einstieg
    const L = STUNT.loop
    if (y < 0.3) {
      const f = (x - L.x) * Math.sin(L.h) + (z - L.z) * Math.cos(L.h), lat = (x - L.x) * Math.cos(L.h) - (z - L.z) * Math.sin(L.h)
      let dh = h - L.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
      if (f >= 0 && f < 2.5 && Math.abs(lat) < 3 && Math.abs(dh) < 0.35 && v >= STUNT.vmin) {
        loop = 0.001; lp = { x: L.x, z: L.z, h: L.h, lat, v0: v }
      }
    }
  }
  const total = free ? c.total : advance(c.total, pr2.s, t.length)
  const pull = c.dmg === 0 && dmg > 0 ? (Math.random() < 0.5 ? -1 : 1) : c.pull
  return { x, z, h, v, steer, total, idx: pr2.i, lap: Math.floor(total / t.length), offroad: free ? pr2.dist > half : pr2.dist > t.hw[pr2.i], lvl, y, vy, loop, lp, bump, slip, dmg, pull, hold: Math.max(0, c.hold - dt), hit, fly, cool }
}

/** Zusammenstoß zweier Autos (Hitboxen): verschiebt `me` (Anteil `share` der Eindringtiefe), bremst und beschädigt.
 *  `ov`/`ow` = Geschwindigkeitsvektor des anderen. Gibt null zurück, wenn sich die Autos nicht berühren. */
export function crash(me: Car, my: CarStats, o: { x: number; z: number; h: number; v: number; slip?: number }, other: { len: number; wid: number }, share = 0.5, cap = DMG_MAX, dmgScale = 1): Car | null {
  const hit = boxHit(boxOf(me, my), boxOf(o, other))
  if (!hit) return null
  const mh = me.h - me.slip, oh = o.h - (o.slip ?? 0)
  const rvx = Math.sin(mh) * me.v - Math.sin(oh) * o.v, rvz = Math.cos(mh) * me.v - Math.cos(oh) * o.v
  // Annäherungstempo entlang der Verbindungslinie der Mittelpunkte: bleibt auch bei tiefem Eindringen (hohes Tempo) richtig
  const dx = o.x - me.x, dz = o.z - me.z, dl = Math.hypot(dx, dz) || 1
  const vn = Math.max(0, -(rvx * hit.nx + rvz * hit.nz), (rvx * dx + rvz * dz) / dl * 0.85)
  let c = { ...me, x: me.x + hit.nx * hit.depth * share, z: me.z + hit.nz * hit.depth * share }
  c.v = me.v * (1 - Math.min(0.5, vn * 0.012))
  c.hit = Math.max(c.hit, Math.min(1, vn / 25))
  c = addDamage(c, impactDamage(vn) * dmgScale, cap)
  return c
}

/** Bots und Fahrassistent: folgen der Ideallinie (kürzester Weg durch die Kurven) mit Geschwindigkeitsprofil. skill 0.7–1. lane = kleiner seitlicher Versatz (m). */
export interface Bot { car: Car; kind: string; color: string; name: string; skill: number; lane: number; wobble: number; finished: number | null; top?: number | null; st: CarStats; /** Versatz zur Linie in der Startaufstellung (m) und Streckenstand beim Start: die Bots bleiben erst in ihrer Spur und ziehen später zur Linie */ lat0?: number; total0?: number; /** Tempolimit wegen eines Autos direkt davor (m/s) */ limit?: number }
/** Tempo, das ein Bot höchstens fahren darf, damit er nicht auf ein Auto direkt vor ihm in seiner Spur auffährt. */
export function packLimit(me: { x: number; z: number; h: number; v: number }, others: Array<{ x: number; z: number; v: number }>): number {
  const fx = Math.sin(me.h), fz = Math.cos(me.h)
  let lim = Infinity
  for (const o of others) {
    const dx = o.x - me.x, dz = o.z - me.z
    const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx)
    if (ahead > 0 && ahead < 28 && side < 3.4) lim = Math.min(lim, Math.max(0, o.v) + (ahead - 7.5) * 0.7)
  }
  return lim
}
export function botInput(b: { car: Car; st: CarStats; skill: number; lane: number; wobble: number; lat0?: number; total0?: number; limit?: number }, line: RaceLine, time: number): Input {
  let lane = b.lane + Math.sin(time * 0.7 + b.wobble) * (1 - b.skill) * 6
  if (b.lat0 !== undefined && b.total0 !== undefined) {
    // erst 60 m geradeaus in der eigenen Spur, dann über 350 m weich zur Linie – so rutschen nicht alle gleichzeitig in die Mitte
    const f = Math.max(0, Math.min(1, (b.car.total - b.total0 - 60) / 350))
    const s = f * f * (3 - 2 * f)
    lane = b.lat0 * (1 - s) + lane * s
  }
  return botSteer(b.car, b.st, line, b.skill, lane, b.limit)
}


/** Im Looping: das Auto läuft auf der Wendel (Energieerhaltung); zu langsam oben = Absturz. */
function loopStep(c: Car, dt: number): Car {
  const lp = c.lp!
  const th = (c.loop ?? 0) + (Math.max(c.v, 2) / STUNT.R) * dt
  const pt = loopPoint(lp, Math.min(th, Math.PI * 2), lp.lat)
  const v = Math.sqrt(Math.max(0, lp.v0 * lp.v0 - 2 * G * pt.y))
  if (th > Math.PI / 2 && th < Math.PI * 1.5 && v < Math.sqrt(G * STUNT.R) * 1.05) {
    // Absturz aus dem Looping
    return { ...c, x: pt.x, z: pt.z, h: lp.h, v: v * 0.6, y: pt.y, vy: 0, loop: 0, lp: undefined, dmg: Math.min(DMG_MAX, c.dmg + impactDamage(14)), hit: 1, bump: 1 }
  }
  if (th >= Math.PI * 2) return { ...c, x: pt.x, z: pt.z, h: lp.h, v, y: 0, vy: 0, loop: 0, lp: undefined, steer: 0, slip: 0 }
  return { ...c, x: pt.x, z: pt.z, h: lp.h, v, y: pt.y, vy: 0, loop: th, steer: 0, slip: 0, idx: c.idx }
}
