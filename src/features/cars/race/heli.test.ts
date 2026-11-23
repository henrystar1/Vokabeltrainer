import { describe, expect, it } from 'vitest'
import { startCar, type Car } from './physics'
import { stepHeli } from './heli'
import { TRACKS, buildTrack } from './track'

const flat = () => 0
describe('Hubschrauber-Flug', () => {
  const base: Car = { ...startCar(buildTrack(TRACKS[13]), 0), x: 0, z: 0, h: 0, v: 0, y: 5 }
  it('W beschleunigt nach vorne, E steigt, R sinkt', () => {
    let c = base
    for (let i = 0; i < 60; i++) c = stepHeli(c, { gas: true, brake: false, left: false, right: false, fly: true }, false, 1 / 60, flat)
    expect(c.z).toBeGreaterThan(5); expect(c.y!).toBeGreaterThan(8)
    const up = c.y!
    for (let i = 0; i < 60; i++) c = stepHeli(c, { gas: false, brake: false, left: false, right: false }, true, 1 / 60, flat)
    expect(c.y!).toBeLessThan(up)
  })
  it('bleibt über Dächern und Boden', () => {
    let c: Car = { ...base, y: 3 }
    for (let i = 0; i < 120; i++) c = stepHeli(c, { gas: false, brake: false, left: false, right: false }, true, 1 / 60, () => 20)
    expect(c.y!).toBeGreaterThanOrEqual(21)
  })
  it('Pfeil/A dreht nach links (Kurs wächst)', () => {
    const c = stepHeli(base, { gas: false, brake: false, left: true, right: false }, false, 0.5, flat)
    expect(c.h).toBeGreaterThan(0)
  })
})
