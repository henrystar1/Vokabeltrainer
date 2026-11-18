import { describe, expect, it } from 'vitest'
import { BRIDGES, CITY, GARAGES, TUNNELS, bridgeAt, bridgeH, city, cityPush, inPark, onDeck, tunnelAt, tunnelD, tunnelRamp } from './city'
import { TRACKS, buildTrack, isOpen } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'

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
    let car: Car = { ...startCar(t, 0), x: 0, z: bz + CITY.bw + 1.5, h: Math.PI, v: 6 }
    for (let i = 0; i < 30 * 8; i++) car = stepCar(car, { ...none, fly: i < 6 }, dt, t, st, true)
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
  it('Tunnel-Netz: Ost-West- und Nord-Süd-Röhren, Rampen an den Enden, dazwischen tief', () => {
    expect(TUNNELS.filter((x) => x.dir === 'x').length).toBeGreaterThanOrEqual(3)
    expect(TUNNELS.filter((x) => x.dir === 'z').length).toBeGreaterThanOrEqual(3)
    const pt = (tu: typeof TUNNELS[number], a: number, p = 0) => (tu.dir === 'x' ? [a, tu.c + p] : [tu.c + p, a]) as [number, number]
    for (const tu of TUNNELS) {
      expect(Math.abs(tu.c % (CITY.pitch / 2))).toBe(0)
      // offene Enden haben eine Rampe (Tiefe 0 am Ende), geschlossene Enden bleiben tief (nur Garagen-Zufahrten sind offen)
      expect(tunnelD(...pt(tu, tu.a0))).toBe(tu.r0 === false ? CITY.td : 0); expect(tunnelD(...pt(tu, tu.a1))).toBe(tu.r1 === false ? CITY.td : 0)
      if (tu.a1 - tu.a0 > 3 * CITY.ramp) { expect(tunnelD(...pt(tu, (tu.a0 + tu.a1) / 2))).toBe(CITY.td); expect(tunnelRamp(...pt(tu, (tu.a0 + tu.a1) / 2))).toBeNull() }
      expect(TUNNELS.length).toBeGreaterThan(8)
    }
    // Rampen anderer Röhren überlappen keine Röhre
    for (const tu of TUNNELS) for (const o of TUNNELS) {
      if (o === tu) continue
      for (const e of [tu.a0 + CITY.ramp / 2, tu.a1 - CITY.ramp / 2]) { if (e === tu.a0 + CITY.ramp / 2 ? tu.r0 === false : tu.r1 === false) continue; const q = pt(tu, e); expect(tunnelAt(q[0], q[1])).toBe(tu) }
    }
    for (const tu of TUNNELS) if (tu.dir === 'x') for (const b of BRIDGES) expect(tu.c).not.toBe(b.bz)
  })
  it('Garage: unter dem Haus hindurch in den Tunnel hinunter, ohne Schaden bis zur Querröhre', () => {
    const g = GARAGES[0], st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: g.out.x, z: g.out.z + 20, h: Math.PI, v: 14 }
    let minD = 0, under = 0
    for (let i = 0; i < 30 * 14 && car.z > 135; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st2, true); minD = Math.max(minD, tunnelD(car.x, car.z) * (car.lvl === -1 ? 1 : 0)); if (car.lvl === -1) under++ }
    expect(minD).toBe(CITY.td)
    expect(under).toBeGreaterThan(30)
    expect(car.z).toBeLessThan(140)
    expect(car.dmg).toBe(0)
  })
  it('geschlossene Straßen-Tunnelenden: man fährt dort nicht hinunter', () => {
    const tu = TUNNELS[0], st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: tu.a0 - 10, z: tu.c, h: Math.PI / 2, v: 15 }
    for (let i = 0; i < 30 * 4; i++) car = stepCar(car, { ...none, gas: true }, dt, t, st2, true)
    expect(car.lvl ?? 0).toBe(0)
  })
  it('Nord-Süd-Röhre: unten an der Kreuzung abbiegen geht', () => {
    const st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: 0, z: 60, h: 0, v: 14, lvl: -1 }
    for (let i = 0; i < 30 * 8; i++) {
      const turn = car.z >= 100 && Math.sin(car.h) < 0.95 ? { ...none, gas: true, left: true } : { ...none, gas: true }
      car = stepCar(car, turn, dt, t, st2, true)
      if (Math.sin(car.h) > 0.95) break
    }
    expect(car.lvl).toBe(-1)
    expect(Math.sin(car.h)).toBeGreaterThan(0.9)
  })
  it('Tunnelwände halten das Auto in der Röhre', () => {
    const tz = TUNNELS.find((x) => x.dir === 'z' && x.c === 240)!, st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: 240, z: -300, h: 0.35, v: 20, lvl: -1 }
    for (let i = 0; i < 30 * 3; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st2, true); expect(Math.abs(car.x - tz.c)).toBeLessThanOrEqual(CITY.tw / 2 + 0.01) }
    expect(car.lvl).toBe(-1)
  })
  it('oben über dem Tunnel fährt man normal weiter (bleibt oben)', () => {
    const tu = TUNNELS[0], st2 = statsFor('roadster', 200)
    let car: Car = { ...startCar(t, 0), x: tu.a0 + CITY.ramp + 60, z: tu.c, h: Math.PI / 2, v: 15 }
    for (let i = 0; i < 30 * 3; i++) { car = stepCar(car, { ...none, gas: true }, dt, t, st2, true); expect(car.lvl ?? 0).toBe(0) }
  })
  it('Park: im Wäldchen ist man versteckt, auf der Straße nicht', () => {
    const p = city().parks[0]
    expect(inPark(p.x, p.z)).toBe(true)
    expect(inPark(p.x + p.size / 2 + 12, p.z)).toBe(false)
  })
})
