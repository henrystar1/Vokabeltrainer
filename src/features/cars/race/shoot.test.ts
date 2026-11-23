import { describe, expect, it } from 'vitest'
import { city } from './city'
import { shotBlocked, shotWallT } from './shoot'

describe('shotWallT', () => {
  const b = city().buildings.find((q) => !q.hid && q.lo === undefined && q.h > 8 && q.kind === undefined)!
  it('Haus zwischen Schütze und Ziel blockt', () => {
    expect(shotBlocked(b.x - b.w / 2 - 6, 1.3, b.z, b.x + b.w / 2 + 6, 1.3, b.z)).toBe(true)
  })
  it('über das Dach geschossen ist frei', () => {
    expect(shotBlocked(b.x - b.w / 2 - 6, b.h + 20, b.z, b.x + b.w / 2 + 6, b.h + 20, b.z)).toBe(false)
  })
  it('freie Straße ist frei', () => {
    expect(shotBlocked(0, 1.3, 0, 100, 1.3, 0)).toBe(false)
    expect(shotWallT(0, 1.3, 0, 100, 1.3, 0)).toBe(Infinity)
  })
  it('im selben Haus zählen Innenwände nicht', () => {
    expect(shotBlocked(b.x - 3, 1.3, b.z, b.x + 3, 1.3, b.z)).toBe(false)
  })
})
