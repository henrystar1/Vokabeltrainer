import { describe, expect, it } from 'vitest'
import { CITY, cityPush } from './city'
import { GATE, MOUNTAINS, OUT, hillH, inOutland, outRoads, spiral } from './mountains'
import { TRACKS, buildTrack } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'
import { copDrive, type BotMem } from './chase'

const dt = 1 / 30
const t = buildTrack(TRACKS[13])
const none = { gas: false, brake: false, left: false, right: false }

describe('Berge hinter der Stadt', () => {
  it('Gelände: Fuß 0, Gipfel hoch, Stadt flach', () => {
    for (const m of MOUNTAINS) { expect(hillH(m.x, m.z)).toBeCloseTo(m.H, 0); expect(hillH(m.x + m.R, m.z)).toBe(0) }
    expect(hillH(0, 0)).toBe(0)
    expect(MOUNTAINS.length).toBeGreaterThanOrEqual(3)
  })
  it('Serpentinen führen von unten bis fast zum Gipfel mit mäßiger Steigung', () => {
    for (const m of MOUNTAINS) {
      const s = spiral(m)
      expect(hillH(s[0][0], s[0][1])).toBeLessThan(m.H * 0.1)
      expect(hillH(...s[s.length - 1])).toBeGreaterThan(m.H * 0.85)
      let steepest = 0
      for (let i = 1; i < s.length; i++) steepest = Math.max(steepest, Math.abs(hillH(...s[i]) - hillH(...s[i - 1])) / Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]))
      expect(steepest).toBeLessThan(0.14)
    }
    expect(outRoads().length).toBeGreaterThanOrEqual(4)
  })
  it('Mauer: nur das Tor ist offen, Außenbereich hat eigene Grenzen', () => {
    const H = CITY.half
    expect(cityPush(0, H + 1)).toBeNull()
    expect(cityPush(0, H)).toBeNull()
    expect(cityPush(GATE + 20, H + 0.5)).not.toBeNull()
    expect(cityPush(-300, H - 1)).not.toBeNull()
    expect(cityPush(300, H + 100)).toBeNull()
    expect(cityPush(OUT.x1 + 10, H + 100)).not.toBeNull()
    expect(cityPush(0, OUT.z1 + 10)).not.toBeNull()
    expect(inOutland(0, H + 50)).toBe(true)
  })
  it('durchs Tor hinaus, Berg hinauf (Auto folgt dem Gelände) und wieder hinunter', () => {
    const st = statsFor('sportwagen', 215)
    let car: Car = { ...startCar(t, 0), x: 0, z: H0() - 80, h: 0, v: 20 }
    const road = spiral(MOUNTAINS[2])
    let maxY = 0
    // Hauptstraße bis zum Berg
    for (let i = 0; i < 30 * 40 && car.z < road[0][1] - 10; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st, true); expect(Math.abs(car.x)).toBeLessThan(20) }
    expect(car.z).toBeGreaterThan(OUT.z0 + 300)
    expect(car.dmg).toBe(0)
    // Serpentine mit dem Bot-Lenker abfahren: Höhe folgt dem Gelände
    const mem: BotMem = { stuck: 0 }
    car = { ...car, x: road[0][0], z: road[0][1], h: Math.atan2(road[3][0] - road[0][0], road[3][1] - road[0][1]), v: 8 }
    let k = 3
    for (let i = 0; i < 30 * 200 && k < road.length - 2; i++) {
      while (k < road.length - 2 && Math.hypot(road[k][0] - car.x, road[k][1] - car.z) < 18) k++
      const tx = road[k][0], tz = road[k][1]
      const diff = Math.atan2(tx - car.x, tz - car.z) - car.h, d = Math.atan2(Math.sin(diff), Math.cos(diff))
      car = stepCar(car, { gas: car.v < 22, brake: false, left: d > 0.05, right: d < -0.05 }, dt, t, st, true)
      expect(Math.abs((car.y ?? 0) - hillH(car.x, car.z))).toBeLessThan(0.5)
      maxY = Math.max(maxY, car.y ?? 0)
      void mem
    }
    expect(maxY).toBeGreaterThan(MOUNTAINS[2].H * 0.6)
  })
  it('Steigung bremst bergauf (langsamer als auf ebener Strecke)', () => {
    const m = MOUNTAINS[0], st = statsFor('sportwagen', 215)
    const run = (x: number, z: number, h: number) => { let car: Car = { ...startCar(t, 0), x, z, h, v: 30 }; for (let i = 0; i < 30 * 4; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true); return car.v }
    const up = run(m.x + m.R * 0.75, m.z, -Math.PI / 2), flat = run(100, 900, -Math.PI / 2)
    expect(up).toBeLessThan(flat - 3)
  })
  it('Polizei-Bot fährt durchs Tor zu einem Bandit im Außenbereich', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 0, z: 480, h: 0, v: 0 }
    const mem: BotMem = { stuck: 0 }
    const tgt = { x: 0, z: 1000 }
    let best = Infinity
    for (let i = 0; i < 30 * 90 && best > 5; i++) {
      const d = copDrive(car, tgt, mem, dt)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, dmg: 0, lvl: 0, y: 0 }
      if (d.repair) car = { ...car, dmg: 0 }
      car = stepCar(car, d.inp, dt, t, st, true)
      best = Math.min(best, Math.hypot(car.x - tgt.x, car.z - tgt.z))
    }
    expect(best).toBeLessThan(8)
  })
})
function H0() { return OUT.z0 }
