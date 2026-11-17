import { CITY, bridgeAt, cityPush, tunnelAt } from './city'
import { flyHeight } from '../stats'
import type { Car, Input } from './physics'

/** Polizeijagd in der offenen Stadt: Rollen, Autos, Fang-Regel und die Fahr-KI der Polizei-Bots. */
export type Role = 'bandit' | 'cop'

/** Autos der Rollen: Bandit schnell und fliegend, Polizei etwas langsamer (Admin-Fahrer: auch fliegend wie der Roadster). */
export function chaseCar(role: Role, isAdminCar: boolean, bot = false): { kind: string; color: string; top: number } {
  if (role === 'bandit') return { kind: 'roadster', color: '#111827', top: 255 }
  if (isAdminCar) return { kind: 'roadster', color: '#f8fafc', top: 215 }
  return { kind: 'sportwagen', color: '#f8fafc', top: bot ? 195 : 215 }
}

export const CATCH_DIST = 4.6
export const CHASE_MAX_MS = 6 * 60 * 1000

type Pos = { x: number; z: number; lvl?: number; fly?: number }
/** Gefangen: Polizeiauto rammt den Bandit (gleiche Ebene, ähnliche Höhe, Auto an Auto). */
export function caught(cop: Pos, bandit: Pos): boolean {
  if ((cop.lvl ?? 0) !== (bandit.lvl ?? 0)) return false
  if (Math.hypot(cop.x - bandit.x, cop.z - bandit.z) > CATCH_DIST) return false
  return Math.abs(flyHeight(cop.fly ?? 0) - flyHeight(bandit.fly ?? 0)) < 3
}

const wrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }
/** Freie Sicht zwischen zwei Punkten (keine Häuser dazwischen). */
export function clearLine(ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 4))
  for (let i = 1; i < n; i++) { const t = i / n; if (cityPush(ax + (bx - ax) * t, az + (bz - az) * t)) return false }
  return true
}

export interface BotMem { stuck: number }
export interface BotDrive { inp: Input; reset?: { x: number; z: number; h: number } }

/** Fahr-KI eines Polizei-Bots: fährt über die Straßen auf `tgt` (den Bandit) zu. */
export function copDrive(car: Car, tgt: { x: number; z: number }, mem: BotMem, dt: number): BotDrive {
  const P = CITY.pitch, K = CITY.K
  const node = (v: number) => Math.max(-K, Math.min(K, Math.round(v / P)))
  const ci = node(car.x), cj = node(car.z), ti = node(tgt.x), tj = node(tgt.z)
  let wx = tgt.x, wz = tgt.z
  const lvl = car.lvl ?? 0
  if (lvl === -1) {
    const tu = tunnelAt(car.x, car.z)
    if (tu) { wx = Math.sin(car.h) >= 0 ? tu.x1 + 8 : tu.x0 - 8; wz = tu.tz }
  } else if (lvl === 1) {
    const b = bridgeAt(car.x, car.z)
    if (b) { wx = Math.sin(car.h) >= 0 ? b.bx1 + 8 : b.bx0 - 8; wz = b.bz }
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
  const brake = car.v > 9 && (Math.abs(diff) > 1.0 || (sharp && dist < 38 && car.v > 15))
  const inp: Input = { gas: !brake && (Math.abs(diff) < 1.3 || car.v < 6), brake, left: diff > 0.07, right: diff < -0.07 }
  mem.stuck = Math.abs(car.v) < 1.5 ? mem.stuck + dt : 0
  if (mem.stuck > 1.6 || car.dmg >= 100) {
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
