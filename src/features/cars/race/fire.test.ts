import { describe, expect, it } from 'vitest'
import { FIRE_SLOT_MS, burnable, currentFire, douse, fireOfSlot, flameLevel, parkSpot } from './fire'

describe('fire', () => {
  it('es gibt brennbare Häuser, keine Sonderhäuser', () => {
    const l = burnable()
    expect(l.length).toBeGreaterThan(20)
    expect(l.every((b) => !b.kind && !b.hid)).toBe(true)
  })
  it('Plan ist deterministisch und liegt im Zeitfenster', () => {
    const a = fireOfSlot(7)!, b = fireOfSlot(7)!
    expect(a.b).toBe(b.b); expect(a.startMs).toBe(b.startMs)
    expect(a.startMs).toBeGreaterThanOrEqual(7 * FIRE_SLOT_MS); expect(a.startMs).toBeLessThan(8 * FIRE_SLOT_MS)
    expect(a.endMs).toBeLessThan(8 * FIRE_SLOT_MS) // brennt aus, bevor das nächste beginnt
  })
  it('currentFire nur zwischen Start und Ende', () => {
    const f = fireOfSlot(3)!
    expect(currentFire(f.startMs - 1)).toBeNull()
    expect(currentFire(f.startMs + 1000)?.slot).toBe(3)
    expect(currentFire(f.endMs + 1)).toBeNull()
  })
  it('Flammenstärke: wächst, sinkt mit Löschen und beim Ausbrennen', () => {
    const f = fireOfSlot(3)!
    expect(flameLevel(f, f.startMs, 100)).toBe(0)
    expect(flameLevel(f, f.startMs + 40_000, 100)).toBe(1)
    expect(flameLevel(f, f.startMs + 40_000, 50)).toBeCloseTo(0.5)
    expect(flameLevel(f, f.endMs - 5_000, 100)).toBeCloseTo(0.2)
    expect(flameLevel(f, f.startMs + 40_000, 0)).toBe(0)
  })
  it('Löschen wirkt nur in Reichweite', () => {
    expect(douse(100, 60, 55, 10)).toBe(100)
    expect(douse(100, 0, 55, 10)).toBe(90)
    expect(douse(5, 0, 55, 10)).toBe(0)
  })
  it('Halteplatz liegt 18 m vor der Wand', () => {
    const b = burnable()[0]
    const p = parkSpot(b, b.x + 500, b.z)
    expect(p.x).toBeCloseTo(b.x + b.w / 2 + 18)
  })
})
