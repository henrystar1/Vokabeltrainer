import { describe, expect, it } from 'vitest'
import { clearPath, makeSafeNav } from './walkSafe'

// Haus von (−10,−10) bis (10,10)
const blocked = (x: number, z: number) => Math.abs(x) < 10 && Math.abs(z) < 10
describe('walkSafe', () => {
  it('Gerade, wenn frei', () => {
    const nav = makeSafeNav(blocked, () => [])
    expect(nav('a', { x: -30, z: 20 }, { x: 30, z: 20 })).toEqual({ x: 30, z: 20 })
  })
  it('Umweg über Route, wenn ein Haus im Weg steht', () => {
    expect(clearPath(blocked, -30, 0, 30, 0)).toBe(false)
    const nav = makeSafeNav(blocked, () => [[-30, 0], [-30, 20], [30, 20], [30, 0]])
    const n = nav('a', { x: -30, z: 0 }, { x: 30, z: 0 })
    expect(blocked(n.x, n.z)).toBe(false)
    expect(n.z).toBeGreaterThan(5)
  })
})
