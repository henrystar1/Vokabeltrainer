import { describe, expect, it } from 'vitest'
import { G, RAMPS, STUNT, arenaPush, groundH, loopPoint } from './stunt'
import { TRACKS, buildTrack, isOpen } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'

const dt = 1 / 30
const none = { gas: false, brake: false, left: false, right: false }
const t = buildTrack(TRACKS[14])
const st = statsFor('sportwagen', 300)
const L = STUNT.loop

describe('Stunt-Park', () => {
  it('ist eine offene Karte', () => {
    expect(TRACKS[14].mode).toBe('stunt'); expect(isOpen(TRACKS[14])).toBe(true)
    for (let s = 0; s < 8; s++) { const c = startCar(t, s); expect(Math.abs(c.x)).toBeLessThan(STUNT.half); expect(groundH(c.x, c.z)).toBe(0) }
  })
  it('Boden-Höhe der Rampen', () => {
    const r = RAMPS[0]
    expect(groundH(r.x, r.z)).toBe(0)
    expect(groundH(r.x, r.z + r.len)).toBeCloseTo(r.h1, 5)
    expect(groundH(r.x + 20, r.z + 5)).toBe(0)
  })
  it('Looping-Wendel: unten, oben auf 2R, wieder unten seitlich versetzt', () => {
    expect(loopPoint(L, 0).y).toBe(0)
    expect(loopPoint(L, Math.PI).y).toBeCloseTo(2 * STUNT.R, 5)
    const e = loopPoint(L, Math.PI * 2)
    expect(e.y).toBeCloseTo(0, 5); expect(e.x - L.x).toBeCloseTo(STUNT.lat, 5)
  })
  it('mit 120 km/h durch den Looping, ohne Schaden, kopfüber, danach geradeaus weiter', () => {
    let car: Car = { ...startCar(t, 0), x: L.x, z: L.z - 20, h: 0, v: 34 }
    let top = 0, looped = false
    for (let i = 0; i < 30 * 8; i++) {
      car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
      if ((car.loop ?? 0) > 0) looped = true
      top = Math.max(top, car.y ?? 0)
    }
    expect(looped).toBe(true)
    expect(top).toBeGreaterThan(2 * STUNT.R - 1)
    expect(car.dmg).toBe(0)
    expect(car.loop ?? 0).toBe(0)
    expect(car.z).toBeGreaterThan(L.z + 20)
    expect(car.x).toBeGreaterThan(L.x + STUNT.lat - 1)
  })
  it('zu langsam (50 km/h): kein Looping, einfach daran vorbei geradeaus', () => {
    let car: Car = { ...startCar(t, 0), x: L.x, z: L.z - 20, h: 0, v: 14 }
    for (let i = 0; i < 30 * 3; i++) { car = stepCar(car, { ...none }, dt, t, st, true); expect(car.loop ?? 0).toBe(0) }
    expect(car.y ?? 0).toBe(0)
  })
  it('Schanze: Sprung in die Luft und sauber landen', () => {
    const r = RAMPS[0]
    let car: Car = { ...startCar(t, 0), x: r.x, z: r.z - 40, h: 0, v: 40 }
    let top = 0, air = false
    for (let i = 0; i < 30 * 7; i++) {
      car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
      top = Math.max(top, car.y ?? 0)
      if ((car.y ?? 0) > groundH(car.x, car.z) + 0.5) air = true
    }
    expect(air).toBe(true)
    expect(top).toBeGreaterThan(r.h1)
    expect(car.y ?? 0).toBe(groundH(car.x, car.z))
    expect(car.dmg).toBeLessThan(25)
  })
  it('Hügel: bei Tempo hebt das Auto am Kamm ab, bei Schritttempo nicht', () => {
    const [up] = RAMPS.slice(2)
    const run = (v: number) => {
      let car: Car = { ...startCar(t, 0), x: up.x, z: up.z - 30, h: 0, v }
      let air = false
      for (let i = 0; i < 30 * 5; i++) { car = stepCar(car, { ...none, gas: v > 20 }, dt, t, st, true); if ((car.y ?? 0) > groundH(car.x, car.z) + 0.3) air = true }
      return air
    }
    expect(run(45)).toBe(true)
    expect(run(4)).toBe(false)
  })
  it('Arena-Zaun hält das Auto drin', () => {
    expect(arenaPush(0, 0)).toBeNull(); expect(arenaPush(STUNT.half + 3, 0)?.nx).toBe(-1)
    let car: Car = { ...startCar(t, 0), x: 200, z: 250, h: Math.PI / 2, v: 40 }
    for (let i = 0; i < 30 * 8; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
    expect(car.x).toBeLessThanOrEqual(STUNT.half + 0.5)
  })
  it('Schwerkraft ist 9,8', () => expect(G).toBe(9.8))
})
