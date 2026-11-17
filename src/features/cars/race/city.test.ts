import { describe, expect, it } from 'vitest'
import { BRIDGES, CITY, TUNNELS, bridgeAt, bridgeH, city, cityPush, inPark, onDeck, tunnelAt, tunnelD, tunnelRamp } from './city'
import { TRACKS, buildTrack, isOpen } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'
import { FLY_SECONDS } from '../stats'

const dt = 1 / 30
const none = { gas: false, brake: false, left: false, right: false }
const t = buildTrack(TRACKS[13])

describe('Stadt', () => {
  it('ist eine offene Karte mit vielen Häusern, Parks und Gassen', () => {
    expect(TRACKS[13].mode).toBe('city'); expect(isOpen(TRACKS[13])).toBe(true)
    const c = city()
    expect(c.buildings.length).toBeGreaterThan(60)
    expect(c.parks.length).toBeGreaterThan(0)
    // Straßen bleiben frei: kein Haus ragt in eine Straße (Mittellinien bei Vielfachen von 120, 24 m breit)
    for (const b of c.buildings) {
      for (const [lo, hi] of [[b.x - b.w / 2, b.x + b.w / 2], [b.z - b.d / 2, b.z + b.d / 2]]) {
        const k = Math.round((lo + hi) / 2 / CITY.pitch - 0.5)
        expect(lo).toBeGreaterThanOrEqual(k * CITY.pitch + CITY.pitch / 2 - 48 - 1e-6)
        expect(hi).toBeLessThanOrEqual(k * CITY.pitch + CITY.pitch / 2 + 48 + 1e-6)
      }
    }
    expect(c.buildings.some((b) => b.w < 50 && b.d < 50)).toBe(true)
  })
  it('Start liegt auf der Straße', () => {
    for (let s = 0; s < 8; s++) { const c = startCar(t, s); expect(cityPush(c.x, c.z)).toBeNull() }
  })
  it('gegen ein Haus fahren: Schaden, man kommt nicht hinein', () => {
    const b = city().buildings[0], st = statsFor('sportwagen', 200)
    let car: Car = { ...startCar(t, 0), x: b.x, z: b.z - b.d / 2 - 30, h: 0, v: 30 }
    for (let i = 0; i < 30 * 4; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st, true); expect(cityPush(car.x, car.z)).toBeNull() }
    expect(car.dmg).toBeGreaterThan(5)
  })
  it('durch eine Gasse fahren geht ohne Schaden', () => {
    const bs = city().buildings
    let alley: { x0: number; z: number } | null = null
    for (const a of bs) for (const b of bs) if (Math.abs(a.x - b.x) < 0.01 && b.z > a.z && Math.abs(b.z - a.z - (a.d + b.d) / 2 - 8) < 0.01) alley = { x0: a.x - a.w / 2, z: (a.z + a.d / 2 + b.z - b.d / 2) / 2 }
    expect(alley).not.toBeNull()
    const st = statsFor('sportwagen', 200)
    let car: Car = { ...startCar(t, 0), x: alley!.x0 - 10, z: alley!.z, h: Math.PI / 2, v: 12 }
    for (let i = 0; i < 60; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
    expect(car.dmg).toBe(0)
    expect(car.x).toBeGreaterThan(alley!.x0 + 35)
  })
  it('Stadtmauer hält das Auto in der Stadt', () => {
    const st = statsFor('sportwagen', 200)
    let car: Car = { ...startCar(t, 0), x: 0, z: 0, h: Math.PI / 2, v: 40 }
    for (let i = 0; i < 30 * 40; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
    expect(Math.abs(car.x)).toBeLessThanOrEqual(CITY.half + 0.5)
  })
})

describe('Brücke', () => {
  const B = BRIDGES[0]
  const bz = B.bz, bx0 = B.bx0, bx1 = B.bx1
  const st = statsFor('roadster', 200)
  it('Höhenprofil: unten an den Enden, oben in der Mitte', () => {
    expect(bridgeH(bx0, bz)).toBe(0); expect(bridgeH(bx1, bz)).toBe(0)
    expect(bridgeH(0, bz)).toBe(CITY.bh)
    expect(onDeck(0, bz)).toBe(true); expect(onDeck(0, bz + 20)).toBe(false)
  })
  it('über die Rampe hinauf auf die Brücke fahren', () => {
    let car: Car = { ...startCar(t, 0), x: bx0 - 10, z: bz, h: Math.PI / 2, v: 15 }
    for (let i = 0; i < 30 * 8; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st, true)
    expect(car.lvl).toBe(1)
    expect(car.x).toBeGreaterThan(bx0 + CITY.ramp)
    expect(car.dmg).toBe(0)
  })
  it('quer unter der Brücke hindurch: bleibt unten', () => {
    let car: Car = { ...startCar(t, 0), x: 0, z: bz - 30, h: 0, v: 15 }
    for (let i = 0; i < 30 * 4; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st, true); expect(car.lvl ?? 0).toBe(0) }
    expect(car.z).toBeGreaterThan(bz + 8)
  })
  it('von der Brücke seitlich herunterfahren: Fall bis zur Straße', () => {
    let car: Car = { ...startCar(t, 0), x: 0, z: bz, h: 0.5, v: 20, lvl: 1 }
    let maxY = 0
    for (let i = 0; i < 30 * 4; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st, true); maxY = Math.max(maxY, car.y ?? 0) }
    expect(car.lvl ?? 0).toBe(0)
    expect(maxY).toBeGreaterThan(2)
    expect(car.y ?? 0).toBe(0)
    expect(car.z).toBeGreaterThan(bz + CITY.bw)
  })
  it('mit dem Flugauto von der Seite auf die Brücke landen', () => {
    let car: Car = { ...startCar(t, 0), x: 0, z: bz + CITY.bw + 1.5, h: Math.PI, v: 1.8 }
    let first = true
    for (let i = 0; i < 30 * (FLY_SECONDS + 3); i++) { car = stepCar(car, { ...none, fly: first }, dt, t, st, true); first = false }
    expect(car.fly).toBe(0)
    expect(car.lvl).toBe(1)
  })
})

describe('Mehrere Brücken, Tunnel, Wäldchen', () => {
  it('Brücken liegen in Straßen, enden auf Kreuzungen und überlappen nicht', () => {
    expect(BRIDGES.length).toBeGreaterThanOrEqual(5)
    for (const b of BRIDGES) {
      for (const v of [b.bz, b.bx0, b.bx1]) expect(Math.abs(v % CITY.pitch)).toBe(0)
      expect(b.bx0).toBeGreaterThanOrEqual(-CITY.half); expect(b.bx1).toBeLessThanOrEqual(CITY.half)
      expect(bridgeH(0, b.bz)).toBeGreaterThan(0)
    }
    expect(new Set(BRIDGES.map((b) => b.bz)).size).toBe(BRIDGES.length)
    expect(bridgeAt(0, 100)).toBeNull()
  })
  it('Stadt ist groß (12 × 12 Blöcke) und hat Parks', () => {
    expect(CITY.half).toBe(CITY.pitch * 6)
    expect(city().parks.length).toBeGreaterThanOrEqual(8)
  })
  it('Tunnel: Rampen an den Enden, dazwischen eben und tief unter der Straße', () => {
    expect(TUNNELS.length).toBeGreaterThanOrEqual(3)
    for (const tu of TUNNELS) {
      for (const v of [tu.tz, tu.x0, tu.x1]) expect(Math.abs(v % CITY.pitch)).toBe(0)
      expect(tunnelD(tu.x0, tu.tz)).toBe(0); expect(tunnelD(tu.x1, tu.tz)).toBe(0)
      expect(tunnelD((tu.x0 + tu.x1) / 2, tu.tz)).toBe(CITY.td)
      expect(tunnelRamp((tu.x0 + tu.x1) / 2, tu.tz)).toBeNull()
      expect(tunnelAt(tu.x0 + 5, tu.tz + 30)).toBeNull()
    }
    for (const tu of TUNNELS) for (const b of BRIDGES) expect(tu.tz).not.toBe(b.bz)
  })
  it('in den Tunnel hinunter, unter der Stadt entlang und wieder hinaus', () => {
    const tu = TUNNELS[0]
    const st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: tu.x0 - 10, z: tu.tz, h: Math.PI / 2, v: 15 }
    let minD = 0, under = 0
    for (let i = 0; i < 30 * 70 && car.x < tu.x1 + 20; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st2, true); minD = Math.max(minD, tunnelD(car.x, car.z) * (car.lvl === -1 ? 1 : 0)); if (car.lvl === -1) under++ }
    expect(minD).toBe(CITY.td)
    expect(under).toBeGreaterThan(30 * 10)
    expect(car.x).toBeGreaterThan(tu.x1)
    expect(car.lvl ?? 0).toBe(0)
    expect(car.dmg).toBe(0)
  })
  it('oben über dem Tunnel fährt man normal weiter (bleibt oben)', () => {
    const tu = TUNNELS[0], st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: tu.x0 + CITY.ramp + 60, z: tu.tz, h: Math.PI / 2, v: 15 }
    for (let i = 0; i < 30 * 3; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st2, true); expect(car.lvl ?? 0).toBe(0) }
  })
  it('Park: im Wäldchen ist man versteckt, auf der Straße nicht', () => {
    const p = city().parks[0]
    expect(inPark(p.x, p.z)).toBe(true)
    expect(inPark(p.x + p.size / 2 + 12, p.z)).toBe(false)
  })
})
