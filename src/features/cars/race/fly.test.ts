import { describe, expect, it } from 'vitest'
import { TRACKS, buildTrack } from './track'
import { assistSteer, botSteer, buildRaceLine } from './line'
import { startCar, statsFor, stepCar, type Car } from './physics'
import { FLY_COOLDOWN, FLY_SECONDS, flyHeight, isBike, canFly, kindStats } from '../stats'
import { UP_MAX, upFactors, upFromShort, upPrice } from '../tuning'

const dt = 1 / 30
function drive(kind: string, seconds: number, fly: (t: number) => boolean) {
  const t = buildTrack(TRACKS[6]), st = statsFor(kind, 300)
  let car: Car = startCar(t, 0)
  const flights: number[] = []
  let t0 = 0, was = false
  for (let time = 0; time < seconds; time += dt) {
    car = stepCar(car, { gas: true, brake: false, left: false, right: false, fly: fly(time) }, dt, t, st, time > 0.5)
    if (car.fly > 0 && !was) t0 = time
    if (car.fly === 0 && was) flights.push(time - t0)
    was = car.fly > 0
  }
  return { car, flights }
}

describe('Roadster: Flug', () => {
  it('nur der Roadster kann fliegen', () => {
    expect(canFly('roadster')).toBe(true)
    expect(canFly('sportwagen')).toBe(false)
    const r = drive('sportwagen', 5, () => true)
    expect(r.flights).toHaveLength(0)
  })
  it('fliegt 2 Sekunden und muss dann 20 Sekunden laden', () => {
    const r = drive('roadster', 30, () => true)
    expect(r.flights.length).toBeGreaterThan(0)
    expect(r.flights[0]).toBeGreaterThan(FLY_SECONDS - 0.1)
    expect(r.flights[0]).toBeLessThan(FLY_SECONDS + 0.1)
    // in 30 s mit Dauerdruck nur ein zweiter Flug nach 2 + 20 s
    const starts: number[] = []
    const t = buildTrack(TRACKS[6]), st = statsFor('roadster', 300)
    let car: Car = startCar(t, 0), was = false
    for (let time = 0; time < 30; time += dt) {
      car = stepCar(car, { gas: true, brake: false, left: false, right: false, fly: true }, dt, t, st, time > 0.5)
      if (car.fly > 0 && !was) starts.push(time)
      was = car.fly > 0
    }
    expect(starts).toHaveLength(2)
    expect(starts[1] - starts[0]).toBeGreaterThan(FLY_SECONDS + FLY_COOLDOWN - 0.2)
  })
  it('Flughöhe: 0 am Boden, hoch in der Mitte', () => {
    expect(flyHeight(0)).toBe(0)
    expect(flyHeight(FLY_SECONDS / 2)).toBeGreaterThan(5)
    expect(flyHeight(FLY_SECONDS)).toBeCloseTo(0, 5)
  })
  it('im Flug gibt es keinen Wandschaden', () => {
    const t = buildTrack(TRACKS[0]), st = statsFor('roadster', 300)
    let car: Car = { ...startCar(t, 0), v: 60, h: startCar(t, 0).h + 1.2, fly: 2 }
    for (let i = 0; i < 40; i++) car = stepCar(car, { gas: true, brake: false, left: false, right: false }, dt, t, st, true)
    expect(car.dmg).toBe(0)
  })
})

describe('Motorräder und Tuning', () => {
  it('Motorrad-Arten sind erkannt und haben Werte', () => {
    for (const k of ['chopper', 'crossbike', 'sportbike']) { expect(isBike(k)).toBe(true); expect(kindStats(k).kmh).toBeGreaterThan(100) }
    expect(isBike('sportwagen')).toBe(false)
    expect(statsFor('sportbike').bike).toBe(true)
  })
  it('Tuning-Faktoren und Preise (wie im SQL)', () => {
    expect(upFactors({ motor: 5, reifen: 0, bremse: 0 }).top).toBeCloseTo(1.2)
    expect(upFactors({ motor: 0, reifen: 5, bremse: 5 })).toMatchObject({ turn: 1.2, brake: 1.3 })
    expect(upPrice(30000, 0)).toBe(3000)
    expect(upPrice(30000, 2)).toBe(9000)
    expect(upPrice(1000, 0)).toBe(500)
    expect(UP_MAX).toBe(5)
    expect(upFromShort({ m: 2 })).toEqual({ motor: 2, reifen: 0, bremse: 0 })
  })
  it('Motor-Stufen machen das Auto schneller', () => {
    expect(statsFor('sportwagen', 250, { motor: 5, reifen: 0, bremse: 0 }).top).toBeGreaterThan(statsFor('sportwagen', 250).top * 1.19)
  })
})

describe('Fahrassistent mit Drift (Supercar)', () => {
  function lap(id: number, assist: boolean) {
    const t = buildTrack(TRACKS[id]), line = buildRaceLine(t), st = statsFor('supercar', 700)
    let car: Car = startCar(t, 0), time = 0, slip = 0
    while (time < 600 && car.total < t.length) {
      const inp = assist ? assistSteer(car, st, line) : botSteer(car, st, line, 1, 0)
      car = stepCar(car, inp, dt, t, st, time > 1, assist)
      time += dt; slip = Math.max(slip, Math.abs(car.slip))
    }
    return { time, dmg: car.dmg, done: car.total >= t.length, slip }
  }
  for (const id of [1, 5, 10]) {
    it(`${TRACKS[id].name}: driftet schadenfrei und ist schneller als ohne Drift`, () => {
      const a = lap(id, true), b = lap(id, false)
      expect(a.done).toBe(true)
      expect(a.dmg).toBeLessThan(3)
      expect(a.slip).toBeGreaterThan(0.1)
      expect(a.time).toBeLessThan(b.time * 0.95)
    })
  }
})

describe('Drift-Arena', () => {
  it('ist Strecke 10, 48 m breit und deutlich breiter als alle anderen', () => {
    expect(TRACKS).toHaveLength(11)
    const d = TRACKS[10]
    expect(d.id).toBe(10)
    expect(d.width).toBe(48)
    expect(Math.max(...TRACKS.slice(0, 10).map((t) => t.width))).toBeLessThan(d.width)
  })
})
