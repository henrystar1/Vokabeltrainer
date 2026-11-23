import { describe, expect, it } from 'vitest'
import { newWalker } from './foot'
import { IRON, stepIron } from './ironman'

const none: Parameters<typeof stepIron>[1] = { fwd: false, back: false, left: false, right: false, up: false, down: false }
const flat = () => 0
describe('stepIron', () => {
  it('steigt mit E und bleibt oben stehen', () => {
    let w = newWalker(0, 0, 0, 0)
    for (let i = 0; i < 60; i++) w = stepIron(w, { ...none, up: true }, 1 / 60, flat, flat)
    expect(w.y).toBeGreaterThan(IRON.climb * 0.9)
    const y = w.y
    for (let i = 0; i < 60; i++) w = stepIron(w, none, 1 / 60, flat, flat)
    expect(w.y).toBeCloseTo(y, 5)
  })
  it('landet mit R auf dem Boden, nie darunter', () => {
    let w = newWalker(0, 0, 0, 30)
    for (let i = 0; i < 300; i++) w = stepIron(w, { ...none, down: true }, 1 / 60, flat, flat)
    expect(w.y).toBe(0)
  })
  it('fliegt in der Luft schneller als er geht', () => {
    const a = stepIron(newWalker(0, 0, 0, 0), { ...none, fwd: true }, 1, flat, flat)
    const b = stepIron(newWalker(0, 0, 0, 20), { ...none, fwd: true }, 1, flat, flat)
    expect(b.z).toBeGreaterThan(a.z * 3)
  })
  it('fliegt nicht seitlich durch ein Haus, aber darüber', () => {
    const house = (x: number, z: number) => (z > 10 && z < 40 && Math.abs(x) < 20 ? 30 : 0)
    let w = newWalker(0, 0, 0, 10)
    for (let i = 0; i < 120; i++) w = stepIron(w, { ...none, fwd: true }, 1 / 60, (x, z, y) => (house(x, z) <= y + 0.6 ? house(x, z) : 0), house)
    expect(w.z).toBeLessThan(10.5)
    let v = newWalker(0, 0, 0, 40)
    for (let i = 0; i < 120; i++) v = stepIron(v, { ...none, fwd: true }, 1 / 60, (x, z, y) => (house(x, z) <= y + 0.6 ? house(x, z) : 0), house)
    expect(v.z).toBeGreaterThan(40)
  })
})
