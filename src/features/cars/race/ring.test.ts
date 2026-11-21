import { describe, expect, it } from 'vitest'
import { CITY, cityPush } from './city'
import { RING, ringPath, outRoads, hillH } from './mountains'
import { TREE_R, treePush, trees } from './forest'
import { CATCH_DIST, copDrive, type BotMem } from './chase'
import { TRACKS, buildTrack } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'

const H = CITY.half
describe('Rennstrecke um die Stadt', () => {
  it('Ring ist geschlossen, liegt außerhalb der Mauer und ist befahrbar', () => {
    const p = ringPath()
    expect(p[0]).toEqual(p[p.length - 1])
    for (const [x, z] of p) {
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThan(H + RING.w + 20)
      expect(cityPush(x, z)).toBeNull()
    }
    expect(outRoads().length).toBeGreaterThan(4)
  })
  it('Keine Mauer: Stadtrand und Außenwelt sind frei, Weltgrenze schiebt zurück', () => {
    expect(cityPush(H + 1, 0)).toBeNull()
    expect(cityPush(0, -H)).toBeNull()
    expect(cityPush(0, H)).toBeNull()
    expect(cityPush(H + 40, 0)).toBeNull()
    expect(cityPush(0, -H - 80)).toBeNull()
    expect(cityPush(-905, 0)?.nx).toBe(1)
    expect(cityPush(0, -905)?.nz).toBe(1)
  })
})

describe('Wald', () => {
  it('viele Bäume, nicht auf Straßen oder der Rennstrecke, Stämme blockieren', () => {
    const ts = trees()
    expect(ts.length).toBeGreaterThan(1500)
    for (const t of ts) { expect(t.z).toBeGreaterThan(RING.h + RING.w); expect(hillH(t.x, t.z)).toBeLessThan(130) }
    const t0 = ts[0]
    const p = treePush(t0.x + 0.1, t0.z)
    expect(p).not.toBeNull()
    expect(p!.depth).toBeGreaterThan(0); expect(p!.depth).toBeLessThanOrEqual(TREE_R * t0.s)
    expect(treePush(0, 900)).toBeNull()
  })
})

describe('Bots um die Stadtmauer', () => {
  const t = buildTrack(TRACKS[13])
  it('Bot von der südlichen Rennstrecke erreicht einen Bandit in der Stadt (über Nordtor)', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 0, z: -RING.h, h: 0, v: 0 }
    const mem: BotMem = { stuck: 0 }
    let best = Infinity
    for (let i = 0; i < 30 * 240; i++) {
      const d = copDrive(car, { x: 120, z: 120 }, mem, 1 / 30)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, lvl: 0, y: 0 }
      car = stepCar(car, d.inp, 1 / 30, t, st, true)
      best = Math.min(best, Math.hypot(car.x - 120, car.z - 120))
      if (best < CATCH_DIST) break
    }
    expect(best).toBeLessThan(CATCH_DIST)
  }, 60000)

  it('Bot aus der Stadt erreicht einen Bandit auf der südlichen Rennstrecke', () => {
    const st = statsFor('sportwagen', 195)
    let car: Car = { ...startCar(t, 0), x: 120, z: 120, h: 0, v: 0 }
    const mem: BotMem = { stuck: 0 }
    let best = Infinity
    for (let i = 0; i < 30 * 400; i++) {
      const d = copDrive(car, { x: 200, z: -RING.h }, mem, 1 / 30)
      if (d.reset) car = { ...car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, lvl: 0, y: 0 }
      car = stepCar(car, d.inp, 1 / 30, t, st, true)
      best = Math.min(best, Math.hypot(car.x - 200, car.z + RING.h))
      if (best < CATCH_DIST) break
    }
    expect(best).toBeLessThan(CATCH_DIST)
  }, 60000)
})
