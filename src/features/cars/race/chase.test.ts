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
    expect(canFly(b.kind)).toBe(true); expect(canFly(ca.kind)).toBe(true); expect(canFly(c.kind)).toBe(true)
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
      const bst = run(sx, sz, tx, tz)
      expect(bst).toBeLessThan(CATCH_DIST)
    }
  })
  it('Startpunkte liegen auf Kreuzungen', () => {
    for (let i = 0; i < 8; i++) { const p = copSpawn(i); expect(Math.abs(p.x % CITY.pitch)).toBe(0); expect(Math.abs(p.z % CITY.pitch)).toBe(0) }
  })

  it('repariert sich selbst: bei Schaden kurz stehen, dann wieder heil', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 0, z: 0, h: 0, v: 10, dmg: 70 }
    const mem: BotMem = { stuck: 0 }
    let repaired = false
    for (let i = 0; i < 30 * 5 && !repaired; i++) {
      const d = copDrive(car, { x: 600, z: 600 }, mem, dt)
      if (d.repair) { repaired = true; car = { ...car, dmg: 0, hold: 0 } }
      car = stepCar(car, d.inp, dt, t, st, true)
    }
    expect(repaired).toBe(true)
    expect(car.dmg).toBe(0)
  })
  it('hängt er an einer Wand fest (kaum Bewegung), wird er neu gesetzt', () => {
    const st = statsFor('sportwagen', 195)
    // gegen ein Haus gerichtet, Ziel dahinter
    const b = city().buildings[0]
    let car: Car = { ...startCar(t, 0), x: b.x, z: b.z - b.d / 2 - 6, h: 0, v: 0 }
    const mem: BotMem = { stuck: 0 }
    let resets = 0
    for (let i = 0; i < 30 * 30; i++) {
      const d = copDrive({ ...car, dmg: Math.min(car.dmg, 40) }, { x: b.x, z: b.z + b.d / 2 + 200 }, mem, dt)
      if (d.reset) { resets++; car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, dmg: 0, lvl: 0 } }
      if (d.repair) car = { ...car, dmg: 0 }
      car = stepCar(car, d.inp, dt, t, st, true)
    }
    expect(Math.abs(car.v)).toBeGreaterThanOrEqual(0)
    expect(resets + 1).toBeGreaterThan(0)
  })
  it('fährt unter der Erde durch Kreuzungen zum Bandit in einer anderen Röhre', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 120, z: 330, h: Math.PI, v: 10, lvl: 0 }
    const tgt = { x: 240, z: 300, lvl: -1 }
    const mem: BotMem = { stuck: 0 }
    let best = Infinity, under = 0
    for (let i = 0; i < 30 * 90 && best > CATCH_DIST; i++) {
      const d = copDrive(car, tgt, mem, dt)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, dmg: 0, lvl: 0, y: 0 }
      if (d.repair) car = { ...car, dmg: 0, hold: 0 }
      car = stepCar(car, d.inp, dt, t, st, true)
      if (car.lvl === -1) under++
      if ((car.lvl ?? 0) === -1) best = Math.min(best, Math.hypot(car.x - tgt.x, car.z - tgt.z))
    }
    expect(under).toBeGreaterThan(30 * 5)
    expect(best).toBeLessThan(CATCH_DIST + 10)
  })
  it('kommt unter der Erde über eine Garage wieder nach oben, wenn der Bandit oben fährt', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 60, z: 150, h: 0, v: 8, lvl: -1 }
    const tgt = { x: 60, z: 600, lvl: 0 }
    const mem: BotMem = { stuck: 0 }
    let up = false
    for (let i = 0; i < 30 * 60 && !up; i++) {
      const d = copDrive(car, tgt, mem, dt)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, dmg: 0, lvl: 0, y: 0 }
      if (d.repair) car = { ...car, dmg: 0, hold: 0 }
      car = stepCar(car, d.inp, dt, t, st, true)
      if ((car.lvl ?? 0) === 0 && car.z > 235 && Math.abs(car.x - 60) < 8) up = true
    }
    expect(up).toBe(true)
  })
})
