import { advance, curveAhead, pointAt, project, type Track } from './track'

/** Fahrwerte je Fahrzeugart: Höchstgeschwindigkeit (m/s), Beschleunigung, Lenkung, Bremse. */
export interface CarStats { top: number; acc: number; turn: number; brake: number }
export const STATS: Record<string, CarStats> = {
  kleinwagen: { top: 44, acc: 15, turn: 1.9, brake: 34 },
  limousine: { top: 52, acc: 16, turn: 1.7, brake: 34 },
  kombi: { top: 50, acc: 15, turn: 1.7, brake: 33 },
  suv: { top: 48, acc: 15, turn: 1.55, brake: 32 },
  pickup: { top: 46, acc: 14, turn: 1.5, brake: 30 },
  cabrio: { top: 58, acc: 18, turn: 1.85, brake: 36 },
  sportwagen: { top: 68, acc: 22, turn: 2.0, brake: 40 },
  bus: { top: 38, acc: 10, turn: 1.25, brake: 26 },
}
export const statsFor = (kind: string): CarStats => STATS[kind] ?? STATS.kleinwagen

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
}

export const CAR_R = 2.2

export function startCar(t: Track, slot: number): Car {
  // Aufstellung: Zweierreihen hinter der Startlinie
  const row = Math.floor(slot / 2), col = slot % 2
  const p = pointAt(t, t.length - 10 - row * 9, (col ? 1 : -1) * t.def.width * 0.22)
  return { x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), v: 0, steer: 0, total: -(10 + row * 9), idx: p.i, lap: 0, offroad: false, bump: 0 }
}

/** Ein Zeitschritt. Arcade-Fahrverhalten: Lenkung hängt vom Tempo ab, Gras bremst, Leitplanken fangen ab. */
export function stepCar(c: Car, inp: Input, dt: number, t: Track, st: CarStats, canDrive = true): Car {
  const gas = canDrive && inp.gas, brake = canDrive && inp.brake
  let v = c.v
  const half = t.def.width / 2
  const pr = project(t, c.x, c.z, c.idx)
  const off = pr.dist > half
  const top = st.top * (off ? 0.5 : 1)
  if (gas) v += st.acc * (1 - Math.max(0, v) / (st.top * 1.08)) * dt
  if (brake) v -= (v > 0 ? st.brake : st.acc * 0.6) * dt
  if (!gas && !brake) v -= Math.sign(v) * Math.min(Math.abs(v), (4 + v * v * 0.004) * dt)
  if (v > top) v -= (v - top) * Math.min(1, 2.4 * dt)
  v = Math.max(-10, v)
  const target = (inp.right ? -1 : 0) + (inp.left ? 1 : 0)
  // Lenkung läuft sanft auf den Zielwert (weniger Zappeln mit Tasten)
  const steer = c.steer + (target - c.steer) * Math.min(1, 7 * dt)
  const grip = Math.min(1, Math.abs(v) / 9)
  const speedFactor = 1 / (1 + Math.abs(v) * 0.028)
  let h = c.h + steer * st.turn * grip * speedFactor * Math.sign(v || 1) * dt * 1.35
  // Seitenrutschen in schnellen Kurven: Tempo geht verloren
  v -= Math.abs(steer) * Math.abs(v) * 0.16 * dt * (Math.abs(v) / st.top)
  let x = c.x + Math.sin(h) * v * dt
  let z = c.z + Math.cos(h) * v * dt
  let bump = 0
  const pr2 = project(t, x, z, pr.i)
  const wall = half + 4.5
  if (pr2.dist > wall) {
    // Leitplanke: zurück auf die Strecke schieben, Tempo wegnehmen, Richtung zur Strecke drehen
    const over = pr2.dist - wall
    const nx = -t.tz[pr2.i] * Math.sign(pr2.lat), nz = t.tx[pr2.i] * Math.sign(pr2.lat)
    x -= nx * over; z -= nz * over
    const tang = Math.atan2(t.tx[pr2.i], t.tz[pr2.i])
    let d = tang - h
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    h += d * Math.min(1, 3 * dt)
    bump = Math.min(1, Math.abs(v) / 30)
    v *= 1 - Math.min(0.9, 2.2 * dt)
  }
  const total = advance(c.total, pr2.s, t.length)
  return { x, z, h, v, steer, total, idx: pr2.i, lap: Math.floor(total / t.length), offroad: pr2.dist > half, bump }
}

/** Autos stoßen sich ab (kreisförmig). Gibt die Verschiebung für `a` zurück. */
export function pushApart(a: { x: number; z: number; v: number }, b: { x: number; z: number }): { dx: number; dz: number; hit: boolean } {
  const dx = a.x - b.x, dz = a.z - b.z
  const d = Math.hypot(dx, dz)
  const min = CAR_R * 2
  if (d >= min || d < 1e-6) return { dx: 0, dz: 0, hit: false }
  const o = (min - d) / 2
  return { dx: (dx / d) * o, dz: (dz / d) * o, hit: true }
}

/** Bots: fahren der Ideallinie nach, bremsen vor Kurven. skill 0.7–1. lane = bevorzugter seitlicher Versatz (m). */
export interface Bot { car: Car; kind: string; color: string; name: string; skill: number; lane: number; wobble: number; finished: number | null }
export function botInput(b: Bot, t: Track, time: number): Input {
  const c = b.car
  const look = 10 + Math.max(0, c.v) * 0.55
  const p = pointAt(t, t.s[c.idx] + look, b.lane + Math.sin(time * 0.7 + b.wobble) * 1.5)
  const want = Math.atan2(p.x - c.x, p.z - c.z)
  let d = want - c.h
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  const ca = curveAhead(t, c.idx, 25 + c.v * 1.6)
  const st = statsFor(b.kind)
  const kAbs = Math.abs(ca.k)
  // Tempo, bei dem die Kurve noch sicher geht
  const safe = kAbs > 0.0006 ? Math.min(st.top, Math.sqrt(26 / kAbs)) * (0.78 + b.skill * 0.22) : st.top
  const targetV = Math.min(st.top * (0.86 + b.skill * 0.14), safe)
  return { gas: c.v < targetV, brake: c.v > targetV + 6, left: d > 0.05, right: d < -0.05 }
}
