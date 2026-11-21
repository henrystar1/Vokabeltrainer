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
  it('läuft ohne Stadtmauer aus der Stadt hinaus', () => {
    let w = newWalker(CITY.half - 10, 0, Math.PI / 2)
    for (let i = 0; i < 300; i++) w = stepWalker(w, { ...idle, fwd: true }, 1 / 30)
    expect(w.x).toBeGreaterThan(CITY.half + 5)
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

import { JUMP_V, footConfig, setFootSpeeds, groundAt } from './foot'
import { PARK, PARK_LANES } from './parkhaus'
import { TUNNELS, city, tunnelD } from './city'
import { buildingAt } from './interior'

describe('Zu Fuß: Springen, Wände, Parkhaus, Tempo', () => {
  it('springt mit Leertaste und ist in der Luft schneller', () => {
    let w = newWalker(0, 0, 0)
    w = stepWalker(w, { ...idle, jump: true }, 1 / 60)
    let top = 0
    for (let i = 0; i < 60; i++) { w = stepWalker(w, { ...idle }, 1 / 60); top = Math.max(top, w.y) }
    expect(top).toBeGreaterThan(0.8); expect(top).toBeLessThan((JUMP_V * JUMP_V) / 48 + 0.1)
    expect(w.y).toBe(0)
    // Lauf am Boden vs. in der Luft
    const a = stepWalker(newWalker(0, 0, 0), { ...idle, fwd: true, run: true }, 0.1)
    let j = stepWalker(newWalker(0, 0, 0), { ...idle, jump: true }, 1 / 60)
    const z0 = j.z
    j = stepWalker(j, { ...idle, fwd: true, run: true }, 0.1)
    expect(j.z - z0).toBeGreaterThan(a.z * 1.1)
  })
  it('läuft auch mit großem Zeitschritt nicht durch Hauswände', () => {
    const b = city().buildings.find((q) => q.lo === undefined && q.w > 30 && q.d > 30)!
    // von Westen mit hohem Tempo und 0,25 s Ruckler gegen die Wand (weit weg von der Tür)
    let w = newWalker(b.x - b.w / 2 - 6, b.z + b.d / 2 - 4, Math.PI / 2)
    for (let i = 0; i < 40; i++) w = stepWalker(w, { ...idle, fwd: true, run: true }, 0.25)
    expect(buildingAt(w.x, w.z)).toBeNull()
  })
  it('Tempo einstellbar', () => {
    setFootSpeeds(9, 20)
    try { expect(footConfig).toEqual({ walk: 9, run: 20 }) } finally { setFootSpeeds(null, null) }
    expect(footConfig.walk).toBe(4.4)
  })
  it('Aussteigen im Parkhaus: Figur bleibt auf der Höhe des Autos (nicht im Schacht)', () => {
    for (const [x, z, y] of [[PARK_LANES.mid, PARK.z0 + 60, 4.5], [PARK_LANES.east, PARK.z0 + 60, -4.5], [PARK_LANES.up, PARK.z0 + 20, 2.25], [PARK_LANES.mid, PARK.z0 + 60, 9]] as const) {
      const w = exitFromCar({ x, z, h: 0, v: 0, wid: 1.9, y, lvl: 0 }, 1)
      expect(Math.abs(groundAt(w.x, w.z, w.y) - y)).toBeLessThan(0.8)
      let q = w
      for (let i = 0; i < 120; i++) q = stepWalker(q, idle, 1 / 60)
      expect(q.y).toBeGreaterThan(y - 0.8)
    }
  })
  it('Tunnel: aussteigen, im Tunnel laufen und über die Rampe wieder hinaus', () => {
    const t = TUNNELS.find((q) => q.r0 === false && q.r1 === false && q.a1 - q.a0 > 60)!
    const m = (t.a0 + t.a1) / 2
    const x = t.dir === 'x' ? m : t.c, z = t.dir === 'x' ? t.c : m
    expect(tunnelD(x, z)).toBeGreaterThan(1.5)
    // Fahrzeug tief im Tunnel: Figur bleibt unten (lvl −1) und fällt nicht auf die Straße
    {
      const w = exitFromCar({ x, z, h: 0, v: 0, wid: 1.9, lvl: -1 }, 1)
      expect(w.lvl).toBe(-1)
      let q = w
      for (let i = 0; i < 60; i++) q = stepWalker(q, { ...idle, fwd: true }, 1 / 60)
      expect(q.y).toBeLessThan(-1)
    }
  })
})
