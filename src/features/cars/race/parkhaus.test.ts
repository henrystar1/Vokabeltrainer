import { describe, expect, it } from 'vitest'
import { PARK, PARK_TOP, parkPush, parkSurfaces } from './parkhaus'
import { startCar, stepCar, statsFor, type Car } from './physics'
import { TRACKS, buildTrack } from './track'

const dt = 1 / 30
const none = { gas: false, brake: false, left: false, right: false, nitro: false, handbrake: false }
const t = buildTrack(TRACKS[13])

describe('Parkhaus', () => {
  it('Flächen liegen mit 4,5 m Abstand übereinander, Rampe steigt 4,5 m', () => {
    const lane = PARK.x0 + 5
    const a = parkSurfaces(lane, PARK.z0 + 18)
    for (let i = 1; i < a.length; i++) expect(a[i] - a[i - 1]).toBeCloseTo(PARK.floorH, 5)
    expect(parkSurfaces(lane, PARK.z0 + PARK.ramp + 5)).toContain(PARK.floorH * PARK.floors)
    expect(parkSurfaces(PARK.x1 - 5, PARK.z0 + 10)).toEqual([PARK.floorH, PARK.floorH * 2, PARK.floorH * 3, PARK.floorH * 4])
    expect(parkSurfaces(0, 0)).toEqual([])
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
    let car: Car = { ...startCar(t, 0), x: PARK.x0 + 13, z: PARK.z0 - 14, h: 0, v: 12 }
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
})
