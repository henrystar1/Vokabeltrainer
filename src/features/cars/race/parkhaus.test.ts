import { describe, expect, it } from 'vitest'
import { PARK, PARK_LANES, PARK_TOP, PARK_TUNNEL, parkPush, parkShaft, parkSurfaces } from './parkhaus'
import { tunnelAt } from './city'
import { startCar, stepCar, statsFor, type Car } from './physics'
import { TRACKS, buildTrack } from './track'

const dt = 1 / 30
const none = { gas: false, brake: false, left: false, right: false, nitro: false, handbrake: false }
const t = buildTrack(TRACKS[13])

describe('Parkhaus', () => {
  it('Flächen: Platten alle 4,5 m, Rampen hinauf (West), Abfahrt ins 1. UG, Abfahrt ins 2. UG (Ost); Schächte ohne Decke', () => {
    const z = PARK.z0 + 18
    expect(parkSurfaces(PARK_LANES.up, z)).toEqual([-9, 2.25, 6.75, 11.25, 15.75])
    expect(parkSurfaces(PARK_LANES.dn, z)).toEqual([-9, -2.25, 4.5, 9, 13.5, 18])
    expect(parkSurfaces(PARK_LANES.east, z)).toEqual([-9, -6.75, 0, 4.5, 9, 13.5, 18])
    expect(parkSurfaces(PARK_LANES.mid, z)).toEqual([-9, -4.5, 0, 4.5, 9, 13.5, 18])
    expect(parkSurfaces(PARK_LANES.up, PARK.z0 + PARK.ramp + 5)).toContain(PARK.floorH * PARK.floors)
    expect(parkSurfaces(PARK_LANES.dn, PARK.z0 + PARK.ramp + 5)).toEqual([-9, -4.5, 0, 4.5, 9, 13.5, 18])
    expect(parkSurfaces(0, 0)).toEqual([])
    expect(parkShaft(PARK_LANES.up, z)).toBe(true)
    expect(parkShaft(PARK_LANES.mid, z)).toBe(false)
  })
  it('Wände halten außen, Süden ist unten offen', () => {
    expect(parkPush(PARK.x0, -180, 1)).not.toBeNull()
    expect(parkPush(PARK.x1, -180, 10)).not.toBeNull()
    expect(parkPush(-180, PARK.z0, 1)).toBeNull()
    expect(parkPush(-180, PARK.z0, 6)).not.toBeNull()
    expect(parkPush(PARK.x0, -180, PARK_TOP + 3)).toBeNull()
    expect(PARK_TOP).toBe(19)
  })
  it('über die Rampe in die erste Ebene fahren', () => {
    const st = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: PARK_LANES.up, z: PARK.z0 - 14, h: 0, v: 12 }
    for (let i = 0; i < 30 * 6 && car.z < PARK.z0 + PARK.ramp + 8; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
    expect(car.y ?? 0).toBeGreaterThan(PARK.floorH - 1)
    expect(car.z).toBeGreaterThan(PARK.z0 + PARK.ramp - 5)
    expect(car.dmg).toBe(0)
  })
  it('Jagd: um das Parkhaus herum darf man höher fliegen (Dach), sonst nur 10 m', () => {
    const st = statsFor('roadster', 215)
    const climb = (x: number): number => {
      let car: Car = { ...startCar(t, 0), x, z: -180, h: 0, v: 0 }
      for (let i = 0; i < 30 * 6; i++) car = stepCar(car, { ...none, fly: true, chase: true }, dt, t, st, true)
      return car.y ?? 0
    }
    expect(climb(-260)).toBeGreaterThan(24)
    expect(climb(-420)).toBeLessThanOrEqual(10.01)
  })
  it('Dach: mit Flug-Taste fliegt man über die Brüstung vom Dach (keine unsichtbare Wand darüber)', () => {
    const st = statsFor('roadster', 215)
    let car: Car = { ...startCar(t, 0), x: -180, z: -180, h: Math.PI / 2, v: 10, y: PARK.floorH * PARK.floors + 1.5 }
    for (let i = 0; i < 30 * 5; i++) car = stepCar(car, { ...none, gas: true, fly: true, chase: true }, dt, t, st, true)
    expect(car.x).toBeGreaterThan(PARK.x1 + 3)
  })
  it('Abfahrt: von der Einfahrt (Straße) nach Norden hinunter ins 1. Untergeschoss', () => {
    const st = statsFor('kleinwagen', 150)
    let car: Car = { ...startCar(t, 0), x: PARK_LANES.dn, z: PARK.z0 - 20, h: 0, v: 8, y: 0 }
    for (let i = 0; i < 30 * 8 && car.z < PARK.z0 + PARK.ramp + 6; i++) car = stepCar(car, { ...none, gas: car.v < 9 }, dt, t, st, true)
    expect(car.y ?? 0).toBeLessThan(-3.5)
    expect(car.dmg).toBe(0)
  })
  it('Wände: auf keiner Ebene kommt man bei Vollgas aus dem Parkhaus oder steckt darin', () => {
    const st = statsFor('roadster', 215)
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (const y of [-9, -4.5, 0, 4.5, 13.5, 18]) for (let n = 0; n < 12; n++) {
      let car: Car = { ...startCar(t, 0), x: PARK.x1 - 14 - rnd() * 20, z: PARK.z0 + 50 + rnd() * 30, h: rnd() * Math.PI * 2, v: 25 + rnd() * 40, y }
      for (let i = 0; i < 30 * 6; i++) {
        car = stepCar(car, { ...none, gas: true, left: i % 40 < 6 }, dt, t, st, true)
        if (y !== 0 || car.z > PARK.z0 + 1) { expect(car.x).toBeGreaterThan(PARK.x0 - 0.5); expect(car.x).toBeLessThan(PARK.x1 + 0.5); expect(car.z).toBeLessThan(PARK.z1 + 0.5) }
      }
    }
  })
  // Fährt Wegpunkte ab (Tempo ~9 m/s, lenkt zum Punkt). Gibt das Auto am Ende und die tiefste/höchste Höhe zurück.
  const follow = (car0: Car, wps: Array<[number, number]>, kind = 'kleinwagen'): { car: Car; ymin: number } => {
    const st = statsFor(kind, 150)
    let car = car0, ymin = 0
    for (const [wx, wz] of wps) {
      for (let i = 0; i < 30 * 40 && Math.hypot(wx - car.x, wz - car.z) > 4.5; i++) {
        let dh = Math.atan2(wx - car.x, wz - car.z) - car.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
        car = stepCar(car, { ...none, gas: car.v < 9, brake: car.v > 11, left: dh > 0.06, right: dh < -0.06 }, dt, t, st, true)
        ymin = Math.min(ymin, car.y ?? 0)
      }
    }
    return { car, ymin }
  }
  it('Fahrt: Einfahrt → 1. UG → 2. UG und wieder hinaus (Abfahrten, ohne Schaden)', () => {
    const z0 = PARK.z0, R = PARK.ramp
    const down = follow({ ...startCar(t, 0), x: PARK_LANES.dn, z: z0 - 20, h: 0, v: 8 }, [[PARK_LANES.dn, z0 + R + 24], [PARK_LANES.east, z0 + R + 24], [PARK_LANES.east, z0 + 4]])
    expect(down.car.y ?? 0).toBeLessThan(-7.5)
    expect(down.car.dmg).toBe(0)
    const out = follow({ ...down.car, h: 0, v: 6 }, [[PARK_LANES.east, z0 + R + 24], [PARK_LANES.dn, z0 + R + 24], [PARK_LANES.dn, z0 - 25]])
    expect(out.car.z).toBeLessThan(z0 - 20)
    expect(out.car.y ?? 0).toBeGreaterThan(-0.5)
    expect(out.car.dmg).toBe(0)
  })
  it('Fahrt: im Zick-Zack über mehrere Rampen hinauf (Mittelspur → nächste Rampe), und wieder hinunter', () => {
    const z0 = PARK.z0, R = PARK.ramp, xU = PARK_LANES.up, xB = PARK_LANES.mid
    const cyc: Array<[number, number]> = [[xU, z0 + R + 14], [xB, z0 + R + 8], [xB, z0 + 6], [xU, z0 + 6]]
    const up = follow({ ...startCar(t, 0), x: xU, z: z0 - 20, h: 0, v: 8 }, [...cyc, ...cyc, [xU, z0 + R + 14]])
    expect(up.car.y ?? 0).toBeGreaterThan(12)
    expect(up.car.dmg).toBe(0)
  })
  it('Tunnel-Anschluss: von Ebene −1 durch die Ostwand in den Tunnel und zurück ins Parkhaus', () => {
    expect(tunnelAt(-150, PARK_TUNNEL.z)).not.toBeNull()
    const z0 = PARK.z0
    // runter auf Ebene −1, dann nach Osten durch die Öffnung bis zur Straßenröhre unter x = −120
    const a = follow({ ...startCar(t, 0), x: PARK_LANES.dn, z: z0 - 20, h: 0, v: 8 }, [[PARK_LANES.dn, z0 + PARK.ramp + 8], [PARK_LANES.mid, PARK_TUNNEL.z], [-135, PARK_TUNNEL.z], [-122, PARK_TUNNEL.z]])
    expect(a.car.lvl).toBe(-1)
    expect(a.car.x).toBeGreaterThan(-130)
    // zurück: wieder auf Ebene −1 im Parkhaus
    const b = follow({ ...a.car, h: -Math.PI / 2 }, [[-150, PARK_TUNNEL.z], [-185, PARK_TUNNEL.z]])
    expect(b.car.lvl ?? 0).toBe(0)
    expect(b.car.y ?? 0).toBeCloseTo(PARK_TUNNEL.y, 0)
  })
  it('Fliegen: im offenen Schacht der Rampen kann man hochfliegen, unter einer Decke nicht', () => {
    const st = statsFor('roadster', 215)
    const climb = (x: number, z: number, y: number): number => {
      let car: Car = { ...startCar(t, 0), x, z, h: 0, v: 0, y }
      for (let i = 0; i < 30 * 3; i++) car = stepCar(car, { ...none, fly: true }, dt, t, st, true)
      return car.y ?? 0
    }
    expect(climb(PARK_LANES.up, PARK.z0 + 10, 0)).toBeGreaterThan(8)
    expect(climb(PARK_LANES.mid, PARK.z0 + 50, 0)).toBeLessThan(1)
  })
})
