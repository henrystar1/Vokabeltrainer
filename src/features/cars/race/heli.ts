import type { Car } from './physics'

/** Eingaben des Hubschraubers: W/S vor und zurück, A/D (und Pfeile) drehen, E steigt, R sinkt. */
export interface HeliInput { gas: boolean; brake: boolean; left: boolean; right: boolean; fly?: boolean }

export const HELI = { top: 56, acc: 24, back: 14, yaw: 1.7, climb: 15, maxY: 170, minClear: 1.4 }

/** Ein Schritt der Hubschrauber-Flugphysik. `down` = R gedrückt, `floor(x,z)` = Boden- oder Dachhöhe unter dem Punkt. */
export function stepHeli(c: Car, inp: HeliInput, down: boolean, dt: number, floor: (x: number, z: number) => number): Car {
  const turn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0)
  let v = c.v
  if (inp.gas) v = Math.min(HELI.top, v + HELI.acc * dt)
  else if (inp.brake) v = Math.max(-HELI.back, v - HELI.acc * 1.2 * dt)
  else v -= v * Math.min(1, 0.7 * dt)
  const h = c.h + turn * HELI.yaw * dt
  const tvy = inp.fly ? HELI.climb : down ? -HELI.climb : 0
  const vy0 = c.vy ?? 0
  const vy = vy0 + (tvy - vy0) * Math.min(1, 5 * dt)
  const x = c.x + Math.sin(h) * v * dt, z = c.z + Math.cos(h) * v * dt
  const y = Math.min(HELI.maxY, Math.max(floor(x, z) + HELI.minClear, (c.y ?? 0) + vy * dt))
  return { ...c, x, z, h, v, vy, y, steer: turn, slip: 0, fly: 0, lvl: 0, dmg: 0, hit: 0 }
}
