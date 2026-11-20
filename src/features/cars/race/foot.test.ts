import { describe, expect, it } from 'vitest'
import { HP_MAX, RUN, carHit, exitFromCar, hitDamage, nearestCar, newWalker, stepWalker } from './foot'
import { CITY } from './city'

const idle = { fwd: false, back: false, left: false, right: false }
describe('Zu Fuß', () => {
  it('läuft vorwärts, dreht sich und bleibt stehen', () => {
    let w = newWalker(0, 0, 0)
    for (let i = 0; i < 30; i++) w = stepWalker(w, { ...idle, fwd: true }, 1 / 30)
    expect(w.z).toBeGreaterThan(4); expect(Math.abs(w.x)).toBeLessThan(0.01)
    const z0 = w.z
    for (let i = 0; i < 30; i++) w = stepWalker(w, idle, 1 / 30)
    expect(w.z).toBeCloseTo(z0, 3)
    for (let i = 0; i < 30; i++) w = stepWalker(w, { ...idle, left: true }, 1 / 30)
    expect(w.h).toBeGreaterThan(2)
    const r = stepWalker(newWalker(0, 0, 0), { ...idle, fwd: true, run: true }, 1)
    expect(r.z).toBeCloseTo(RUN, 0)
  })
  it('geht nicht durch die Stadtmauer und Häuser', () => {
    let w = newWalker(CITY.half - 10, 0, Math.PI / 2)
    for (let i = 0; i < 300; i++) w = stepWalker(w, { ...idle, fwd: true }, 1 / 30)
    expect(w.x).toBeLessThan(CITY.half + 0.5)
  })
  it('Auto überfährt die Figur: Schaden und Rückstoß weg vom Auto, langsames Auto nicht', () => {
    const car = { x: 0, z: 0, h: 0, v: 20, len: 4.4, wid: 1.9 }
    const w = newWalker(0, 2.4, 0)
    const h = carHit(w, car)!
    expect(h.hp).toBe(HP_MAX - hitDamage(20))
    expect(h.vz).toBeGreaterThan(10); expect(h.vy).toBeGreaterThan(3); expect(h.stun).toBeGreaterThan(1)
    expect(carHit(w, { ...car, v: 2 })).toBeNull()
    expect(carHit(newWalker(0, 9, 0), car)).toBeNull()
    expect(carHit(h, car)).toBeNull() // kurz unverwundbar
    // fliegt ein Stück
    let f = h
    for (let i = 0; i < 40; i++) f = stepWalker(f, idle, 1 / 30)
    expect(f.z).toBeGreaterThan(8)
  })
  it('Aussteigen: im Stand heil und ohne Schwung, bei Tempo Schwung und Schaden', () => {
    const a = exitFromCar({ x: 0, z: 0, h: 0, v: 0, wid: 1.9 })
    expect(a.hp).toBe(HP_MAX); expect(Math.hypot(a.vx, a.vz)).toBeLessThan(0.01)
    const b = exitFromCar({ x: 0, z: 0, h: 0, v: 30, wid: 1.9 })
    expect(b.hp).toBeLessThan(HP_MAX); expect(b.vz).toBeGreaterThan(10)
  })
  it('nächstes Auto in Reichweite', () => {
    const cs = [{ x: 3, z: 0 }, { x: 12, z: 0 }]
    expect(nearestCar({ x: 0, z: 0 }, cs)).toBe(cs[0])
    expect(nearestCar({ x: 0, z: 30 }, cs)).toBeNull()
  })
})
