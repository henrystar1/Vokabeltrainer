import { describe, expect, it } from 'vitest'
import { TRACKS, buildTrack, isOpen } from './track'
import { buildRaceLine } from './line'
import { botInput, crash, packLimit, startCar, statsFor, stepCar, type Bot, type Car } from './physics'

/** Ein Bot fährt allein eine Runde; gibt Zeit, Schaden und Gesamtstrecke zurück. */
function lap(trackId: number, kind: string, top: number | null, skill: number) {
  const t = buildTrack(TRACKS[trackId])
  const line = buildRaceLine(t)
  const st = statsFor(kind, top)
  let car: Car = startCar(t, 0)
  const b = { car, st, skill, lane: 0, wobble: 0 }
  let time = 0, maxOff = 0
  const dt = 1 / 30
  while (time < 900 && car.total < t.length) {
    b.car = car
    car = stepCar(car, botInput(b, line, time), dt, t, st, time > 1, false)
    time += dt
    maxOff = Math.max(maxOff, car.offroad ? 1 : 0)
  }
  return { time, dmg: car.dmg, done: car.total >= t.length, off: maxOff, len: t.length }
}

describe('Ideallinien-Bots', () => {
  for (const kind of ['kleinwagen', 'sportwagen', 'rennwagen']) {
    it(`${kind} fährt auf allen Strecken eine Runde ohne Schaden`, () => {
      for (const tr of TRACKS.filter((x) => !isOpen(x))) {
        const r = lap(tr.id, kind, null, 1)
        expect(r.done, `${tr.name} ${kind} fertig`).toBe(true)
        expect(r.dmg, `${tr.name} ${kind} Schaden`).toBeLessThan(5)
      }
    })
  }
  it('Profi mit 400 km/h ist auf dem Highspeed-Ring deutlich schneller als ein Kleinwagen', () => {
    const fast = lap(6, 'rennwagen', 400, 1), slow = lap(6, 'kleinwagen', null, 1)
    expect(fast.time).toBeLessThan(slow.time * 0.6)
  })
  it('bessere Fahrer sind schneller', () => {
    expect(lap(0, 'sportwagen', null, 1).time).toBeLessThan(lap(0, 'sportwagen', null, 0.7).time)
  })
})

/** Startpulk: 8 Profis aus der Aufstellung, die ersten 700 m; Summe der Schäden. */
function pack(trackId: number, keepLane: boolean) {
  const t = buildTrack(TRACKS[trackId]), line = buildRaceLine(t), st = statsFor('gt', 300)
  const bots: Bot[] = Array.from({ length: 8 }, (_, i) => {
    const c = startCar(t, i)
    const lat0 = (c.x - line.x[c.idx]) * -t.tz[c.idx] + (c.z - line.z[c.idx]) * t.tx[c.idx]
    return { car: c, kind: 'gt', color: '#fff', name: 'b' + i, skill: 1, lane: (i % 5 - 2) * Math.min(2.6, t.def.width * 0.09), wobble: i * 1.7, finished: null, st, ...(keepLane ? { lat0, total0: c.total } : {}) }
  })
  for (let k = 0; k < 30 * 40; k++) {
    for (const b of bots) { b.limit = keepLane ? packLimit(b.car, bots.filter((o) => o !== b).map((o) => o.car)) : undefined }
    for (const b of bots) b.car = stepCar(b.car, botInput(b, line, k / 30), 1 / 30, t, b.st, k > 30, false)
    for (const a of bots) for (const b of bots) if (a !== b) { const c = crash(a.car, a.st, { x: b.car.x, z: b.car.z, h: b.car.h, v: b.car.v }, b.st, 0.5, 85); if (c) a.car = c }
    if (bots.every((b) => b.car.total > 700)) break
  }
  return bots.reduce((sum, b) => sum + b.car.dmg, 0)
}
describe('Startpulk', () => {
  for (const id of [0, 3, 6, 10]) {
    it(`${TRACKS[id].name}: Bots bleiben beim Start in ihrer Spur und crashen kaum`, () => {
      const old = pack(id, false), now = pack(id, true)
      expect(now).toBeLessThanOrEqual(old)
      expect(now).toBeLessThan(id === 3 ? 25 : 10)
    })
  }
})
