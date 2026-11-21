import { describe, expect, it } from 'vitest'
import { POI_RANGE, poiNear, pois } from './poi'

describe('Besondere Häuser', () => {
  it('eine Bank, vier Shops, zwei Fitnessstudios, verschieden und mit Tür', () => {
    const p = pois()
    expect(p.filter((q) => q.kind === 'bank')).toHaveLength(1)
    expect(p.filter((q) => q.kind === 'shop')).toHaveLength(4)
    expect(p.filter((q) => q.kind === 'gym')).toHaveLength(2)
    expect(new Set(p.map((q) => q.b)).size).toBe(p.length)
    for (const q of p) expect(Number.isFinite(q.x + q.z)).toBe(true)
  })
  it('poiNear findet das Haus an der Tür, aber nicht weit weg', () => {
    const q = pois()[0]
    expect(poiNear(q.x, q.z)?.id).toBe(q.id)
    expect(poiNear(q.x + POI_RANGE + 5, q.z)).toBeNull()
  })
})
