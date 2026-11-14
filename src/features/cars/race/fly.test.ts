import { describe, expect, it } from 'vitest'
import { TRACKS, buildTrack, roadProximity } from './track'
import { assistSteer, botSteer, buildRaceLine } from './line'
import { crash, startCar, statsFor, stepCar, type Car } from './physics'
import { FLY_COOLDOWN, FLY_SECONDS, flyConfig, flyHeight, flyRoll, isBike, canFly, kindStats, setFlyConfig } from '../stats'
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
    expect(canFly('supercar')).toBe(true)
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
    for (const k of ['chopper', 'crossbike', 'sportbike', 'hyperbike']) { expect(isBike(k)).toBe(true); expect(kindStats(k).kmh).toBeGreaterThan(100) }
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

describe('Szenerie-Abstand', () => {
  it('roadProximity findet jede Straße, auch weit entfernte Streckenteile', () => {
    for (const id of [0, 3, 10]) {
      const t = buildTrack(TRACKS[id]), near = roadProximity(t)
      for (let i = 0; i < t.n; i += 17) {
        expect(near(t.x[i], t.z[i], 5)).toBe(true)
        expect(near(t.x[i] - t.tz[i] * (t.def.width / 2 + 2), t.z[i] + t.tx[i] * (t.def.width / 2 + 2), t.def.width / 2 + 8)).toBe(true)
      }
      expect(near(1e6, 1e6, 100)).toBe(false)
    }
  })
})

describe('Schnelleres Motorrad', () => {
  it('Hyper-Bike ist schneller als das Sportbike', () => {
    expect(kindStats('hyperbike').kmh).toBeGreaterThan(kindStats('sportbike').kmh * 1.5)
    expect(statsFor('hyperbike', 520).top * 3.6).toBeCloseTo(520, 0)
  })
})

describe('Flug-Einstellungen vom Admin', () => {
  it('Flugdauer, Ladezeit und Rolle sind einstellbar', () => {
    setFlyConfig({ sec: 5, cool: 3, roll: true })
    try {
      expect(flyConfig).toEqual({ sec: 5, cool: 3, roll: true })
      const t = buildTrack(TRACKS[6]), st = statsFor('supercar', 300)
      let car: Car = startCar(t, 0), was = false, t0 = 0, len = 0, starts: number[] = []
      for (let time = 0; time < 14; time += dt) {
        car = stepCar(car, { gas: true, brake: false, left: false, right: false, fly: true }, dt, t, st, time > 0.5)
        if (car.fly > 0 && !was) { t0 = time; starts.push(time) }
        if (car.fly === 0 && was) len = time - t0
        was = car.fly > 0
      }
      expect(len).toBeGreaterThan(4.9); expect(len).toBeLessThan(5.2)
      expect(starts[1] - starts[0]).toBeGreaterThan(8 - 0.2)
      expect(flyRoll(5)).toBeCloseTo(0, 5)
      expect(flyRoll(2.5)).toBeCloseTo(Math.PI, 5)
      expect(flyRoll(0)).toBe(0)
      expect(flyHeight(2.5)).toBeGreaterThan(5)
    } finally { setFlyConfig(null) }
    expect(flyConfig).toEqual({ sec: 2, cool: 20, roll: false })
    expect(flyRoll(1)).toBe(0)
  })
})

describe('Zusammenstöße', () => {
  const st = statsFor('gt', 300)
  const base = (t: ReturnType<typeof buildTrack>) => startCar(t, 0)
  it('Frontalcrash mit 700 km/h zerstört das Auto (nicht nur 10 %)', () => {
    const t = buildTrack(TRACKS[6]), a = { ...base(t), v: 194 }
    const o = { x: a.x + Math.sin(a.h) * 3.5, z: a.z + Math.cos(a.h) * 3.5, h: a.h + Math.PI, v: 0 }
    const r = crash(a, st, o, st, 0.5)
    expect(r).not.toBeNull()
    expect(r!.dmg).toBe(100)
  })
  it('beide Autos bekommen gleich viel Schaden (gleiche Lage, gleiche Daten)', () => {
    const t = buildTrack(TRACKS[6]), a = { ...base(t), v: 40 }
    const b = { ...a, x: a.x + Math.sin(a.h) * 4, z: a.z + Math.cos(a.h) * 4, h: a.h + Math.PI, v: 30 }
    const ra = crash(a, st, { x: b.x, z: b.z, h: b.h, v: b.v }, st, 0.5, 100)
    const rb = crash(b, st, { x: a.x, z: a.z, h: a.h, v: a.v }, st, 0.5, 100)
    expect(ra && rb).toBeTruthy()
    expect(Math.abs(ra!.dmg - rb!.dmg)).toBeLessThan(1)
    expect(ra!.dmg).toBeGreaterThan(30)
  })
  it('bei hohem Tempo rast man in Teilschritten nicht durch ein stehendes Auto', () => {
    const t = buildTrack(TRACKS[10]), s2 = statsFor('supercar', 700)
    let car: Car = { ...base(t), v: 190 }
    const o = { x: car.x + Math.sin(car.h) * 40, z: car.z + Math.cos(car.h) * 40, h: car.h, v: 0 }
    let hit = false
    for (let f = 0; f < 30 && !hit; f++) {
      const n = Math.max(1, Math.min(240, Math.ceil(Math.abs(car.v) * dt / 1.6)))
      for (let k = 0; k < n && !hit; k++) {
        car = stepCar(car, { gas: true, brake: false, left: false, right: false }, dt / n, t, s2, true)
        const c = crash(car, s2, o, st, 0.5)
        if (c) { car = c; hit = true }
      }
    }
    expect(hit).toBe(true)
    expect(car.dmg).toBeGreaterThan(60)
  })
})

describe('Tempo bis 100.000 km/h', () => {
  it('Auto bleibt bei 100.000 km/h rechnerisch gültig', () => {
    const t = buildTrack(TRACKS[6]), s2 = statsFor('supercar', 100000)
    expect(s2.top * 3.6).toBeCloseTo(100000, -1)
    let car: Car = startCar(t, 0), vmax = 0
    for (let f = 0; f < 600; f++) {
      const n = Math.max(1, Math.min(240, Math.ceil(Math.abs(car.v) * dt / 1.6)))
      for (let k = 0; k < n; k++) car = stepCar(car, { gas: true, brake: false, left: false, right: false }, dt / n, t, s2, true)
      vmax = Math.max(vmax, car.v)
    }
    for (const x of [car.x, car.z, car.v, car.h, car.total, car.dmg]) expect(Number.isFinite(x)).toBe(true)
    expect(vmax).toBeGreaterThan(100)
  })
})
