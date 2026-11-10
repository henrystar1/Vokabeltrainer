import { describe, expect, it } from 'vitest'
import { ARENA, collide, lookDir, makeBoxes, shoot, SPAWNS, timeLeft, winnerSeat } from './engine'

describe('Shooter-Engine', () => {
  it('Hindernisse sind pro Spiel gleich und lassen die Startecken frei', () => {
    const a = makeBoxes('abc')
    expect(a).toEqual(makeBoxes('abc'))
    expect(a).not.toEqual(makeBoxes('xyz'))
    for (const [sx, sz] of SPAWNS) expect(a.some((b) => Math.hypot(b.x - sx, b.z - sz) < 8 && !(b.x === 0 && b.z === 0))).toBe(false)
  })
  it('Kollision hält im Feld und schiebt aus Kisten', () => {
    const box = { x: 0, z: 0, w: 4, d: 4, h: 2 }
    expect(collide(100, -100, 0.5, [])).toEqual([ARENA - 0.5, -ARENA + 0.5])
    const [x, z] = collide(0.5, 0.5, 0.5, [box])
    expect(Math.abs(x) >= 2.5 - 1e-6 || Math.abs(z) >= 2.5 - 1e-6).toBe(true)
  })
  it('Treffer: freie Sicht trifft, Kiste dazwischen verdeckt', () => {
    const o = { x: 0, y: 1.6, z: 0 }
    const d = lookDir(0, 0) // Richtung −z
    const target = [{ id: 'u', x: 0, z: -10 }]
    expect(shoot(o, d, [], target)?.id).toBe('u')
    expect(shoot(o, d, [{ x: 0, z: -5, w: 2, d: 2, h: 3 }], target)).toBeNull()
    expect(shoot(o, lookDir(Math.PI / 2, 0), [], target)).toBeNull()
  })
  it('Zeit und Sieger', () => {
    expect(timeLeft(0, 5, 60_000)).toBe(240)
    expect(timeLeft(0, 5, 999_999)).toBe(0)
    expect(winnerSeat({ 0: 3, 1: 7 })).toBe(1)
    expect(winnerSeat({ 0: 5, 1: 5 })).toBeNull()
  })
})
