import { describe, expect, it } from 'vitest'
import { TRACKS, buildTrack } from './track'
import { buildRaceLine } from './line'
import { botInput, startCar, statsFor, stepCar, type Car } from './physics'

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
      for (const tr of TRACKS) {
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
