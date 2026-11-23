import { beforeEach, describe, expect, it } from 'vitest'
import { addGlassHole, clearGlassHoles, inGlassHole } from './glass'
import { pois } from './poi'
import { interiorPush } from './interior'

describe('glass', () => {
  beforeEach(() => clearGlassHoles())
  it('Lücke nur im richtigen Geschoss und an der richtigen Stelle', () => {
    addGlassHole(100, 50, 4, 3, true)
    expect(inGlassHole(101, 50.4, 0)).toBe(true)
    expect(inGlassHole(105, 50, 0)).toBe(false)
    expect(inGlassHole(100, 50, 8.15)).toBe(false)
  })
  it('Bank-Außenwand hat dort keinen Widerstand', () => {
    const b = pois().find((p) => p.kind === 'bank')!.b
    const x = b.x, z = b.z - b.d / 2 + 0.2
    expect(interiorPush(b, x, z, 0)).not.toBeNull()
    addGlassHole(x, b.z - b.d / 2, 4, 3.4, true)
    expect(interiorPush(b, x, z, 0)).toBeNull()
  })
})
