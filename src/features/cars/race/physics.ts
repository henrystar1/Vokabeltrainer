import { advance, pointAt, project, type Track } from './track'
import { carKmh, kindDims, kindStats } from '../stats'
import { boxHit, corners, impactDamage, type Box } from './collide'
import { botSteer, type RaceLine } from './line'

/** Fahrwerte eines Autos: Höchstgeschwindigkeit (m/s), Beschleunigung, Lenkung, Bremse. */
export interface CarStats { top: number; acc: number; turn: number; brake: number; len: number; wid: number }
/** Werte je Art; mit `kmh` (eigener Höchstwert des Autos) wird Tempo und Beschleunigung entsprechend skaliert. */
export const statsFor = (kind: string, kmh?: number | null): CarStats => {
  const k = kindStats(kind)
  const f = carKmh(kind, kmh) / k.kmh
  const d = kindDims(kind)
  return { top: (k.kmh * f) / 3.6, acc: k.acc * Math.pow(f, 0.8), turn: k.turn, brake: k.brake * Math.pow(f, 0.5), len: d.len, wid: d.wid }
}
export const STATS: Record<string, CarStats> = Object.fromEntries(['kleinwagen', 'limousine', 'kombi', 'suv', 'pickup', 'cabrio', 'sportwagen', 'bus', 'oldtimer', 'buggy', 'monstertruck', 'muscle', 'rallye', 'gt', 'hypercar', 'rennwagen'].map((k) => [k, statsFor(k)]))

export interface Input { gas: boolean; brake: boolean; left: boolean; right: boolean }
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
}

export const CAR_R = 2.2

export function startCar(t: Track, slot: number): Car {
  // Aufstellung: Zweierreihen hinter der Startlinie
  const row = Math.floor(slot / 2), col = slot % 2
  const p = pointAt(t, t.length - 10 - row * 9, (col ? 1 : -1) * t.def.width * 0.22)
  return { x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), v: 0, steer: 0, total: -(10 + row * 9), idx: p.i, lap: 0, offroad: false, bump: 0, slip: 0, dmg: 0, pull: 1, hold: 0, hit: 0 }
}

export const DMG_MAX = 100
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
  const d = c.dmg / DMG_MAX
  const wrecked = c.dmg >= DMG_MAX
  const waiting = c.hold > 0
  const can = canDrive && !wrecked && !waiting
  const gas = can && inp.gas, brake = canDrive && inp.brake && !waiting
  let v = c.v
  const half = t.def.width / 2
  const pr = project(t, c.x, c.z, c.idx)
  const off = pr.dist > half
  const top = st.top * (off ? 0.5 : 1) * (wrecked ? 0.12 : 1 - 0.5 * d)
  const acc = st.acc * (1 - 0.55 * d)
  const target = (inp.right ? -1 : 0) + (inp.left ? 1 : 0)
  const drifting = drift && can && brake && target !== 0 && v > 14
  if (gas) v += acc * (1 - Math.max(0, v) / (st.top * 1.08)) * dt
  if (brake) v -= (v > 0 ? st.brake * (drifting ? 0.3 : 1) : st.acc * 0.6) * dt
  if (!gas && !brake) v -= Math.sign(v) * Math.min(Math.abs(v), (4 + v * v * 0.004 + (wrecked ? 10 : 0)) * dt)
  if (waiting) v -= Math.sign(v) * Math.min(Math.abs(v), 40 * dt)
  if (v > top) v -= (v - top) * Math.min(1, 2.4 * dt)
  v = Math.max(-10, v)
  // Lenkung läuft sanft auf den Zielwert (weniger Zappeln mit Tasten)
  const steer = c.steer + (target - c.steer) * Math.min(1, 7 * dt)
  const grip = Math.min(1, Math.abs(v) / 9)
  const speedFactor = 1 / (1 + Math.abs(v) * 0.022)
  // Driftwinkel: baut sich beim Driften auf, sonst bekommen die Reifen wieder Halt
  const slipTarget = drifting ? Math.sign(target) * Math.min(0.7, 0.22 + v / 140) : 0
  const slip = c.slip + (slipTarget - c.slip) * Math.min(1, (drifting ? 3.2 : 2.4) * dt)
  let h = c.h + steer * st.turn * grip * speedFactor * Math.sign(v || 1) * dt * 1.35 * (1 + Math.abs(slip) * 0.9)
  // beschädigtes Auto zieht zur Seite
  if (d > 0.3) h += c.pull * (d - 0.3) * 0.5 * Math.min(1, Math.abs(v) / 25) * dt
  // Seitenrutschen in schnellen Kurven und beim Driften: Tempo geht verloren
  v -= Math.abs(steer) * Math.abs(v) * 0.16 * dt * (Math.abs(v) / st.top)
  v -= Math.abs(slip) * Math.abs(v) * 0.22 * dt
  const moveH = h - slip
  let x = c.x + Math.sin(moveH) * v * dt
  let z = c.z + Math.cos(moveH) * v * dt
  let bump = 0
  let hit = 0
  let dmg = c.dmg
  // Leitplanke: die Ecken der Karosserie zählen, nicht nur die Mitte
  const wall = half + 4.5
  const pr2 = project(t, x, z, pr.i)
  let worst = 0, wi = pr2.i, wl = pr2.lat
  for (const [cx, cz] of corners({ x, z, h, l: st.len, w: st.wid })) {
    const q = project(t, cx, cz, pr2.i)
    if (q.dist - wall > worst) { worst = q.dist - wall; wi = q.i; wl = q.lat }
  }
  if (worst > 0) {
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
  const total = advance(c.total, pr2.s, t.length)
  const pull = c.dmg === 0 && dmg > 0 ? (Math.random() < 0.5 ? -1 : 1) : c.pull
  return { x, z, h, v, steer, total, idx: pr2.i, lap: Math.floor(total / t.length), offroad: pr2.dist > half, bump, slip, dmg, pull, hold: Math.max(0, c.hold - dt), hit }
}

/** Zusammenstoß zweier Autos (Hitboxen): verschiebt `me` (Anteil `share` der Eindringtiefe), bremst und beschädigt.
 *  `ov`/`ow` = Geschwindigkeitsvektor des anderen. Gibt null zurück, wenn sich die Autos nicht berühren. */
export function crash(me: Car, my: CarStats, o: { x: number; z: number; h: number; v: number; slip?: number }, other: { len: number; wid: number }, share = 0.5, cap = DMG_MAX): Car | null {
  const hit = boxHit(boxOf(me, my), boxOf(o, other))
  if (!hit) return null
  const mh = me.h - me.slip, oh = o.h - (o.slip ?? 0)
  const rvx = Math.sin(mh) * me.v - Math.sin(oh) * o.v, rvz = Math.cos(mh) * me.v - Math.cos(oh) * o.v
  const vn = Math.max(0, -(rvx * hit.nx + rvz * hit.nz))
  let c = { ...me, x: me.x + hit.nx * hit.depth * share, z: me.z + hit.nz * hit.depth * share }
  c.v = me.v * (1 - Math.min(0.5, vn * 0.012))
  c.hit = Math.max(c.hit, Math.min(1, vn / 25))
  c = addDamage(c, impactDamage(vn) * 0.7, cap)
  return c
}

/** Bots und Fahrassistent: folgen der Ideallinie (kürzester Weg durch die Kurven) mit Geschwindigkeitsprofil. skill 0.7–1. lane = kleiner seitlicher Versatz (m). */
export interface Bot { car: Car; kind: string; color: string; name: string; skill: number; lane: number; wobble: number; finished: number | null; top?: number | null; st: CarStats }
export function botInput(b: { car: Car; st: CarStats; skill: number; lane: number; wobble: number }, line: RaceLine, time: number): Input {
  return botSteer(b.car, b.st, line, b.skill, b.lane + Math.sin(time * 0.7 + b.wobble) * (1 - b.skill) * 6)
}
