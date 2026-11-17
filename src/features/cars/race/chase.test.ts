import { describe, expect, it } from 'vitest'
import { CATCH_DIST, caught, chaseCar, clearLine, copDrive, copSpawn, type BotMem } from './chase'
import { CITY, city } from './city'
import { TRACKS, buildTrack } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'
import { canFly, carKmh } from '../stats'

const dt = 1 / 30
const t = buildTrack(TRACKS[13])

describe('Polizeijagd: Autos und Fangen', () => {
  it('Bandit ist schneller als jede Polizei, beide Admin-/Bandit-Autos fliegen', () => {
    const b = chaseCar('bandit', false), c = chaseCar('cop', false), ca = chaseCar('cop', true), cb = chaseCar('cop', false, true)
    expect(carKmh(b.kind, b.top)).toBeGreaterThan(carKmh(c.kind, c.top))
    expect(carKmh(b.kind, b.top)).toBeGreaterThan(carKmh(ca.kind, ca.top))
    expect(cb.top).toBeLessThan(c.top)
    expect(canFly(b.kind)).toBe(true); expect(canFly(ca.kind)).toBe(true); expect(canFly(c.kind)).toBe(false)
  })
  it('gefangen nur bei Berührung auf gleicher Ebene und Höhe', () => {
    expect(caught({ x: 0, z: 0 }, { x: CATCH_DIST - 0.5, z: 0 })).toBe(true)
    expect(caught({ x: 0, z: 0 }, { x: CATCH_DIST + 1, z: 0 })).toBe(false)
    expect(caught({ x: 0, z: 0, lvl: 1 }, { x: 1, z: 0 })).toBe(false)
    expect(caught({ x: 0, z: 0, fly: 0 }, { x: 1, z: 0, fly: 1 })).toBe(false)
  })
  it('Sicht: Häuser blockieren, Straße ist frei', () => {
    expect(clearLine(0, -100, 0, 100)).toBe(true)
    const b = city().buildings[0]
    expect(clearLine(b.x, b.z - b.d / 2 - 30, b.x, b.z + b.d / 2 + 30)).toBe(false)
  })
})

describe('Polizei-Bot fährt zum Bandit', () => {
  const run = (sx: number, sz: number, tx: number, tz: number, seconds = 120) => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: sx, z: sz, h: 0, v: 0 }
    const mem: BotMem = { stuck: 0 }
    let best = Infinity
    for (let i = 0; i < 30 * seconds; i++) {
      const d = copDrive(car, { x: tx, z: tz }, mem, dt)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, lvl: 0, y: 0 }
      car = stepCar(car, d.inp, dt, t, st, true)
      best = Math.min(best, Math.hypot(car.x - tx, car.z - tz))
      if (best < CATCH_DIST) break
    }
    return best
  }
  it('erreicht einen Bandit auf einer anderen Straße (ohne Häuser zu durchfahren)', () => {
    const P = CITY.pitch
    for (const [sx, sz, tx, tz] of [[-P, -P, 3 * P, 2 * P], [P, P, -4 * P, -3 * P], [0, 5 * P, 5 * P, -5 * P], [2 * P, -P, 2 * P + 40, 3 * P]]) {
      expect(run(sx, sz, tx, tz)).toBeLessThan(CATCH_DIST)
    }
  })
  it('Startpunkte liegen auf Kreuzungen', () => {
    for (let i = 0; i < 8; i++) { const p = copSpawn(i); expect(Math.abs(p.x % CITY.pitch)).toBe(0); expect(Math.abs(p.z % CITY.pitch)).toBe(0) }
  })
})
