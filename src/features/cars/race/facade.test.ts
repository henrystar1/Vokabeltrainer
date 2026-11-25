import { describe, expect, it } from 'vitest'
import { city } from './city'
import { layoutOf } from './interior'
import { facadeFor, wantsFacade, type Geo } from './facade'

describe('facade', () => {
  it('erzeugt gültige Geometrie für alle geeigneten Häuser', () => {
    const g: Geo = { pos: [], nor: [], col: [], idx: [] }
    const list = city().buildings.filter(wantsFacade)
    expect(list.length).toBeGreaterThan(100)
    for (const b of list) facadeFor(b, layoutOf(b).door, g)
    expect(g.pos.length / 3).toBe(g.nor.length / 3)
    expect(g.pos.length / 3).toBe(g.col.length / 3)
    expect(g.idx.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(g.pos.length / 3)
    expect(g.pos.every(Number.isFinite)).toBe(true)
    console.log('Fassade: Häuser', list.length, 'Ecken', g.pos.length / 3)
  })
})
